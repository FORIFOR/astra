/**
 * 監査ハッシュ連鎖の結合テスト。受け入れテスト AC-15 の基盤。
 *   ./infra/db/with-test-db.sh pnpm --filter @astra/telemetry test
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { uuidv7 } from '@astra/contracts';
import { createDb, withIdentity, withTenant, type DbHandle } from '@astra/db';
import { appendAuditEvent, readAuditChain, verifyAuditChain } from '../src/audit.js';

const url = process.env['TEST_DATABASE_URL'];
const identityUrl = process.env['TEST_IDENTITY_DATABASE_URL'];

const tenant1 = uuidv7();
const tenant2 = uuidv7();
const user1 = uuidv7();

describe.skipIf(!url)('audit chain against a real database', () => {
  let handle: DbHandle;

  beforeAll(async () => {
    handle = createDb({
      url: url!,
      identityUrl,
      maxConnections: 6,
      identityMaxConnections: 2,
      idleTimeoutMillis: 5_000,
      connectionTimeoutMillis: 5_000,
      statementTimeoutMillis: 10_000,
      applicationName: 'astra-test',
    });
    await withIdentity(handle, async (tx) => {
      await tx
        .insertInto('tenants')
        .values([
          { id: tenant1, name: 'T1', kind: 'personal' },
          { id: tenant2, name: 'T2', kind: 'personal' },
        ])
        .execute();
      await tx
        .insertInto('users')
        .values({ id: user1, email: `u-${user1}@example.com`, display_name: 'U' })
        .execute();
      await tx
        .insertInto('memberships')
        .values({ tenant_id: tenant1, user_id: user1, role: 'owner' })
        .execute();
    });
  });

  afterAll(async () => {
    await handle?.close();
  });

  it('starts the chain at seq 1 with no prev_hash', async () => {
    const first = await withTenant(handle, tenant1, (tx) =>
      appendAuditEvent(tx, tenant1, { actorType: 'user', actorId: user1, action: 'task.created' }),
    );
    expect(first.seq).toBe(1);

    const rows = await withTenant(handle, tenant1, (tx) => readAuditChain(tx, tenant1));
    expect(rows[0]?.prev_hash).toBeNull();
    expect(await verifyAuditChain(rows)).toEqual([]);
  });

  it('links each subsequent event to the previous hash', async () => {
    for (const action of ['session.created', 'plugin.install', 'artifact.created'] as const) {
      await withTenant(handle, tenant1, (tx) =>
        appendAuditEvent(tx, tenant1, {
          actorType: 'user',
          actorId: user1,
          action,
          externalEffect: action === 'plugin.install',
          payload: { note: action },
        }),
      );
    }
    const rows = await withTenant(handle, tenant1, (tx) => readAuditChain(tx, tenant1));
    expect(rows).toHaveLength(4);
    expect(rows.map((r) => r.seq)).toEqual([1, 2, 3, 4]);
    for (let i = 1; i < rows.length; i += 1) {
      expect(rows[i]!.prev_hash).toBe(rows[i - 1]!.hash);
    }
    expect(await verifyAuditChain(rows)).toEqual([]);
  });

  it('survives what the database returns, not just what we wrote', async () => {
    // created_at は timestamptz として往復する。ハッシュ対象の表現がずれていれば
    // ここで hash_mismatch になる（読み出し経路の回帰検査）
    const rows = await withTenant(handle, tenant1, (tx) => readAuditChain(tx, tenant1));
    expect(await verifyAuditChain(rows)).toEqual([]);
  });

  it('serializes concurrent appends without gaps or duplicates', async () => {
    // audit_sequences の行ロックが直列化を担う。ここが崩れると連鎖が成立しない。
    const before = (await withTenant(handle, tenant1, (tx) => readAuditChain(tx, tenant1))).length;
    await Promise.all(
      Array.from({ length: 12 }, (_, i) =>
        withTenant(handle, tenant1, (tx) =>
          appendAuditEvent(tx, tenant1, {
            actorType: 'system',
            action: 'task.created',
            payload: { i },
          }),
        ),
      ),
    );
    const rows = await withTenant(handle, tenant1, (tx) => readAuditChain(tx, tenant1));
    expect(rows).toHaveLength(before + 12);
    expect(rows.map((r) => r.seq)).toEqual(rows.map((_, i) => i + 1));
    expect(await verifyAuditChain(rows)).toEqual([]);
  });

  it('returns the chain in numeric sequence order, not lexicographic', async () => {
    // seq は bigint。text へ落として同名の別名を付けると ORDER BY が別名を掴み、
    // 1, 10, 11, 12, 2, ... と並ぶ（実装時に踏んだ）。
    const rows = await withTenant(handle, tenant1, (tx) => readAuditChain(tx, tenant1));
    expect(rows.length).toBeGreaterThan(10);
    expect(rows.map((r) => r.seq)).toEqual([...rows.map((r) => r.seq)].sort((a, b) => a - b));
  });

  it('keeps each tenant on its own chain', async () => {
    await withTenant(handle, tenant2, (tx) =>
      appendAuditEvent(tx, tenant2, { actorType: 'system', action: 'task.created' }),
    );
    const t2 = await withTenant(handle, tenant2, (tx) => readAuditChain(tx, tenant2));
    expect(t2).toHaveLength(1);
    expect(t2[0]?.seq).toBe(1);

    // 他テナントの連鎖は RLS で見えない
    const leaked = await withTenant(handle, tenant2, (tx) => readAuditChain(tx, tenant1));
    expect(leaked).toEqual([]);
  });

  it('refuses to mutate what was written', async () => {
    await expect(
      withTenant(handle, tenant1, (tx) =>
        tx.updateTable('audit_events').set({ action: 'tampered' }).execute(),
      ),
    ).rejects.toThrow(/append-only/);
  });
});
