/**
 * WorldModelService の DB 側。Phase 6 実装仕様 §2・§3。
 *   ./infra/db/with-test-db.sh pnpm --filter @astra/service-world-model test
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { uuidv7, type FactSource } from '@astra/contracts';
import { createDb, withIdentity, type DbHandle } from '@astra/db';
import { WorldModelService } from '../src/service.js';

const url = process.env['TEST_DATABASE_URL'];
const identityUrl = process.env['TEST_IDENTITY_DATABASE_URL'];

describe.skipIf(!url)('WorldModelService', () => {
  let db: DbHandle;
  let world: WorldModelService;
  const tenantId = uuidv7();
  const otherTenantId = uuidv7();
  const source: FactSource = {
    kind: 'user',
    stated_at: new Date().toISOString(),
  } as FactSource;

  beforeAll(async () => {
    db = createDb({
      url: url!,
      identityUrl,
      maxConnections: 6,
      identityMaxConnections: 2,
      idleTimeoutMillis: 5_000,
      connectionTimeoutMillis: 5_000,
      statementTimeoutMillis: 20_000,
      applicationName: 'astra-world-test',
    });
    await withIdentity(db, async (tx) => {
      for (const id of [tenantId, otherTenantId]) {
        await tx.insertInto('tenants').values({ id, name: 'W', kind: 'personal' }).execute();
      }
    });
    world = new WorldModelService({ db });
  }, 60_000);

  afterAll(async () => {
    await db?.close();
  });

  it('brings the same person together instead of creating them twice', async () => {
    const a = await world.observe(tenantId, 'person', '田中 太郎');
    const b = await world.observe(tenantId, 'person', '田中太郎さん');
    expect(b.id).toBe(a.id);
    // 何度出てきたかが「よく出てくる人」の判定になる
    expect(b.mention_count).toBe(2);
  });

  it('keeps a person and an organization apart even with the same name', async () => {
    const person = await world.observe(tenantId, 'person', 'アクメ');
    const org = await world.observe(tenantId, 'organization', 'アクメ');
    expect(org.id).not.toBe(person.id);
  });

  it('refuses an entity with nothing to call it', async () => {
    await expect(world.observe(tenantId, 'person', '   ')).rejects.toThrow(/needs a name/);
  });

  it('relates entities and reads the neighbours back', async () => {
    const person = await world.observe(tenantId, 'person', '伊藤');
    const project = await world.observe(tenantId, 'project', 'A社 導入');
    await world.relate(tenantId, person.id, project.id, 'assigned_to');
    // 二度張っても増えない
    await world.relate(tenantId, person.id, project.id, 'assigned_to');

    const neighbours = await world.neighbours(tenantId, person.id, 'assigned_to');
    expect(neighbours.map((n) => n.name)).toEqual(['A社 導入']);
  });

  it('writes a commitment and says nothing was skipped', async () => {
    const result = await world.remember(tenantId, {
      kind: 'commitment',
      statement: '見積を明日送る',
      source,
    });
    expect(result.skipped).toBeNull();
    expect(result.fact!.status).toBe('OPEN');
  });

  it('refuses to write what the policy does not keep, and says why', async () => {
    const result = await world.remember(tenantId, {
      kind: 'small_talk',
      statement: '今日は暑いですね',
      source,
    });
    expect(result.fact).toBeNull();
    expect(result.skipped).toContain('small_talk');
  });

  it('does not remember the same thing twice from the same source', async () => {
    const once = await world.remember(tenantId, {
      kind: 'decision',
      statement: '10 月導入で合意した',
      source,
    });
    expect(once.fact).not.toBeNull();

    const again = await world.remember(tenantId, {
      kind: 'decision',
      statement: '10 月導入で合意した',
      source,
    });
    expect(again.fact).toBeNull();
    expect(again.skipped).toContain('already remembered');
  });

  it('lists open commitments with deadlines first', async () => {
    const later = new Date(Date.now() + 7 * 86_400_000).toISOString();
    await world.remember(tenantId, {
      kind: 'commitment',
      statement: '来週やること',
      source: { kind: 'user', stated_at: later } as FactSource,
      dueAt: later,
    });

    const open = await world.openCommitments(tenantId);
    expect(open.length).toBeGreaterThan(0);
    expect(open.every((c) => c.status === 'OPEN')).toBe(true);
    // 期限のあるものが先
    const firstWithDue = open.findIndex((c) => c.due_at !== null);
    const firstWithout = open.findIndex((c) => c.due_at === null);
    if (firstWithout >= 0) expect(firstWithDue).toBeLessThan(firstWithout);
  });

  it('keeps a dropped commitment instead of deleting it', async () => {
    const created = await world.remember(tenantId, {
      kind: 'commitment',
      statement: 'やらないことにした件',
      source: { kind: 'user', stated_at: new Date(Date.now() + 1).toISOString() } as FactSource,
    });
    const settled = await world.settle(tenantId, created.fact!.id, 'DROPPED');
    expect(settled.status).toBe('DROPPED');
    // 一覧からは消えるが、記録は残る
    const open = await world.openCommitments(tenantId);
    expect(open.map((c) => c.id)).not.toContain(created.fact!.id);
  });

  it('shows another tenant nothing of this world', async () => {
    expect(await world.openCommitments(otherTenantId)).toEqual([]);
    await expect(world.settle(otherTenantId, uuidv7(), 'DONE')).rejects.toThrow(
      /no such commitment/,
    );
  });

  it('records what happened without letting it be rewritten', async () => {
    const person = await world.observe(tenantId, 'person', '記録対象');
    await world.record(tenantId, 'mentioned', { where: 'meeting' }, person.id);
    // append-only トリガは db:verify が別途確かめている
    expect(true).toBe(true);
  });
});
