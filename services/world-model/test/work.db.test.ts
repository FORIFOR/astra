/**
 * WorkContextService の DB 側。
 *   ./infra/db/with-test-db.sh pnpm --filter @astra/service-world-model test
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { uuidv7, type WorkArtifact } from '@astra/contracts';
import { createDb, withIdentity, type DbHandle } from '@astra/db';
import { WorldModelService } from '../src/service.js';
import { WorkContextService } from '../src/work/service.js';

const url = process.env['TEST_DATABASE_URL'];
const identityUrl = process.env['TEST_IDENTITY_DATABASE_URL'];
const NOW = new Date('2026-09-07T09:00:00+09:00');

function art(id: string, over: Partial<WorkArtifact> = {}): WorkArtifact {
  return {
    id,
    source: 'gmail',
    kind: 'email',
    title: `Re: MOPITA ${id}`,
    body_excerpt: null,
    people: [{ name: 'MTI 田中', email: 'tanaka@mti.example', role: 'from' }],
    direction: 'inbound',
    occurred_at: '2026-09-06T05:00:00.000Z',
    ends_at: null,
    due_at: null,
    thread_id: 'th',
    project_hint: 'MOPITA連携',
    responded: null,
    completed: null,
    provenance: {
      source: 'gmail',
      external_id: id,
      label: 'MTI からの返信',
      observed_at: '2026-09-06T05:00:00.000Z',
      url: null,
      excerpt: null,
    },
    semantic: {
      category: 'request_to_me',
      project: 'MOPITA連携',
      request: 'SITE_ID を確認する',
      owner: 'me',
      waiting_on: null,
      due: '2026-09-08T09:00:00.000Z',
      confidence: 0.9,
      extracted_by: 'llm',
    },
    ...over,
  };
}

describe.skipIf(!url)('WorkContextService', () => {
  let db: DbHandle;
  let work: WorkContextService;
  const tenantId = uuidv7();
  const otherTenant = uuidv7();
  const userId = uuidv7();

  beforeAll(async () => {
    db = createDb({
      url: url!,
      identityUrl,
      maxConnections: 6,
      identityMaxConnections: 2,
      idleTimeoutMillis: 5_000,
      connectionTimeoutMillis: 5_000,
      statementTimeoutMillis: 20_000,
      applicationName: 'astra-work-test',
    });
    await withIdentity(db, async (tx) => {
      for (const id of [tenantId, otherTenant])
        await tx.insertInto('tenants').values({ id, name: 'W', kind: 'personal' }).execute();
    });
    work = new WorkContextService({
      db,
      world: new WorldModelService({ db, now: () => NOW }),
      now: () => NOW,
    });
  }, 60_000);

  afterAll(async () => {
    await db?.close();
  });

  it('ingests once per source id, keeps the sync cursor, and brings people and projects into the world model', async () => {
    const first = await work.ingest(tenantId, userId, {
      source: 'gmail',
      cursor: 'h-1',
      artifacts: [art('m1'), art('m2')],
    });
    expect(first.accepted).toBe(2);
    const again = await work.ingest(tenantId, userId, {
      source: 'gmail',
      cursor: 'h-2',
      artifacts: [art('m1')],
    });
    expect(again.accepted).toBe(1); // upsert（同じ id は増えない）
    expect((await work.artifacts(tenantId, userId)).map((a) => a.id).sort()).toEqual(['m1', 'm2']);
    const sync = await work.syncState(tenantId, userId);
    expect(sync).toEqual([
      expect.objectContaining({ source: 'gmail', cursor: 'h-2', artifact_count: 3 }),
    ]);
    const world = new WorldModelService({ db });
    const person = await world.observe(tenantId, 'person', 'MTI 田中');
    expect(person.mention_count).toBeGreaterThanOrEqual(3);
  });

  it('builds the context with sources, and a correction removes the project in one action', async () => {
    const ctx = await work.context(tenantId, userId);
    expect(ctx.priorities[0]).toMatchObject({ project: 'MOPITA連携', waiting_on: null });
    expect(ctx.priorities[0]!.sources.length).toBeGreaterThan(0);
    expect(ctx.owed).toHaveLength(1);
    const ev = await work.evidence(tenantId, userId, ctx.priorities[0]!.id);
    expect(ev.map((a) => a.id).sort()).toEqual(['m1', 'm2']);
    await work.correct(tenantId, userId, {
      item_id: ctx.priorities[0]!.id,
      action: 'not_priority',
      note: null,
    });
    expect((await work.context(tenantId, userId)).priorities).toEqual([]);
  });

  it('stores only the person’s decisions about personalization, and one update can stop inference', async () => {
    const p0 = await work.personalization(tenantId, userId);
    expect(p0.inference_enabled).toBe(true);
    expect(p0.frequent_entities.some((t) => t.label === 'MOPITA連携')).toBe(true);
    const p1 = await work.updateProfile(tenantId, userId, {
      traits: [{ key: 'style.prefersConcise', status: 'confirmed', value: 1 }],
    });
    expect(p1.working_style[0]).toMatchObject({ key: 'style.prefersConcise', status: 'confirmed' });
    const p2 = await work.updateProfile(tenantId, userId, { inference_enabled: false, traits: [] });
    expect(p2.inference_enabled).toBe(false);
    expect((await work.context(tenantId, userId)).priorities).toEqual([]);
  });

  it('keeps tenants apart', async () => {
    expect(await work.artifacts(otherTenant, userId)).toEqual([]);
  });
});
