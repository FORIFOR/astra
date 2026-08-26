/**
 * DomainService の DB 側。Phase 5 実装仕様 §3。
 *   ./infra/db/with-test-db.sh pnpm --filter @astra/service-agent-runtime test
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { uuidv7 } from '@astra/contracts';
import { createDb, withIdentity, withSystem, type DbHandle } from '@astra/db';
import { DomainService } from '../src/domain.js';
import { SALES_CRM_ENTITIES, nextBestActions, pipelineSummary } from '../src/sales-crm.js';

const url = process.env['TEST_DATABASE_URL'];
const identityUrl = process.env['TEST_IDENTITY_DATABASE_URL'];
const PLUGIN_ID = 'com.astra.research';

describe.skipIf(!url)('DomainService', () => {
  let db: DbHandle;
  let domain: DomainService;
  const tenantId = uuidv7();
  const otherTenantId = uuidv7();
  const userId = uuidv7();

  const opportunity = (fields: Record<string, unknown>) =>
    domain.create({
      tenantId,
      userId,
      pluginId: PLUGIN_ID,
      def: SALES_CRM_ENTITIES['opportunity']!,
      fields,
    });

  beforeAll(async () => {
    db = createDb({
      url: url!,
      identityUrl,
      maxConnections: 6,
      identityMaxConnections: 2,
      idleTimeoutMillis: 5_000,
      connectionTimeoutMillis: 5_000,
      statementTimeoutMillis: 20_000,
      applicationName: 'astra-domain-test',
    });

    await withIdentity(db, async (tx) => {
      for (const id of [tenantId, otherTenantId]) {
        await tx.insertInto('tenants').values({ id, name: 'D', kind: 'personal' }).execute();
      }
      await tx
        .insertInto('users')
        .values({ id: userId, email: `d-${userId}@example.com`, display_name: 'D' })
        .execute();
      await tx
        .insertInto('memberships')
        .values({ tenant_id: tenantId, user_id: userId, role: 'owner' })
        .execute();
    });
    // plugin 行が要る（FK）。同梱のものを使う。
    await withSystem(db, (tx) =>
      tx
        .insertInto('plugin_publishers')
        .values({ id: 'astra', display_name: 'Astra', public_key: '', verified: true })
        .onConflict((oc) => oc.column('id').doNothing())
        .execute(),
    );
    await withSystem(db, (tx) =>
      tx
        .insertInto('plugins')
        .values({
          id: PLUGIN_ID,
          publisher_id: 'astra',
          name: 'Research',
          category: 'domain-agent',
          builtin: true,
          removable: false,
          latest_version: '0.1.0',
        })
        .onConflict((oc) => oc.column('id').doNothing())
        .execute(),
    );

    domain = new DomainService({ db });
  }, 60_000);

  afterAll(async () => {
    await db?.close();
  });

  it('refuses to store a value the definition does not allow', async () => {
    await expect(opportunity({ name: 'A社', stage: 'maybe' })).rejects.toThrow(/invalid/);
  });

  it('stores only the fields the definition mentions', async () => {
    const created = await opportunity({ name: 'A社', stage: 'lead', sneaky: 'x' });
    expect(Object.keys(created.fields).sort()).toEqual(['name', 'stage']);
    // 一覧の見出しは title_field から取る
    expect(created.title).toBe('A社');
  });

  it('lists what this tenant put in, and nothing else', async () => {
    const rows = await domain.list(tenantId, PLUGIN_ID, 'opportunity');
    expect(rows.length).toBeGreaterThan(0);
    // 別テナントには何も見えない（AC5-10）
    expect(await domain.list(otherTenantId, PLUGIN_ID, 'opportunity')).toEqual([]);
  });

  it('says another tenant’s entity does not exist', async () => {
    const created = await opportunity({ name: 'B社', stage: 'lead' });
    const other = new DomainService({ db });
    await expect(other.get(otherTenantId, created.id)).rejects.toThrow(/not found/);
  });

  it('links entities and reads them back', async () => {
    const opp = await opportunity({ name: 'C社', stage: 'proposal' });
    const act = await domain.create({
      tenantId,
      userId,
      pluginId: PLUGIN_ID,
      def: SALES_CRM_ENTITIES['activity']!,
      fields: { summary: '見積を送付', occurred_at: '2026-07-01', kind: 'email' },
    });
    await domain.link(tenantId, opp.id, act.id, 'activity');
    // 二度張っても増えない
    await domain.link(tenantId, opp.id, act.id, 'activity');

    const linked = await domain.linked(tenantId, opp.id, 'activity');
    expect(linked.map((e) => e.title)).toEqual(['見積を送付']);
  });

  it('feeds the pipeline and the next best action from what was stored', async () => {
    const opp = await opportunity({ name: 'D社', stage: 'qualified', amount: 5_000 });
    const stored = await domain.list(tenantId, PLUGIN_ID, 'opportunity');

    const summary = pipelineSummary(stored);
    expect(summary.find((s) => s.stage === 'qualified')!.total).toBeGreaterThanOrEqual(5_000);

    const actions = nextBestActions(
      [{ opportunity: await domain.get(tenantId, opp.id), activities: [] }],
      { now: new Date('2026-08-26T00:00:00.000Z') },
    );
    expect(actions[0]!.why).toContain('1 件も残っていません');
  });

  it('groups by any enum field without needing new SQL', async () => {
    const groups = await domain.groupBy(tenantId, PLUGIN_ID, 'opportunity', 'stage', 'amount');
    expect(groups.some((g) => g.group === 'lead')).toBe(true);
    expect(groups.every((g) => g.count > 0)).toBe(true);
  });
});
