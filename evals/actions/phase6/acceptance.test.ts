/**
 * Phase 6 受け入れテスト。Phase 6 実装仕様 §0 の AC6-1〜AC6-10。
 *
 *   pnpm test:acceptance
 *
 * 「精度高く出る」は、**出すものが正しい**ことと
 * **出さないものを出さない**ことの両方で見る。後者のほうが壊れやすい。
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Writable } from 'node:stream';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  MAX_ATTENTION_ITEMS,
  uuidv7,
  type DailyBrief,
  type FactSource,
  type TokenResponse,
  type WorldFact,
} from '@astra/contracts';
import { createDb, type DbHandle } from '@astra/db';
import { createLogger } from '@astra/telemetry';
import { FsObjectStore, LibraryService } from '@astra/service-library';
import { PluginRegistryService } from '@astra/service-plugin-registry';
import { InMemoryTaskRuntime, TaskService } from '@astra/service-task';
import { WorldModelService } from '@astra/service-world-model';
import {
  MemoryRateLimiter,
  buildApp,
  JwtTokens,
  loadSigningKeys,
  type App,
} from '@astra/service-api-gateway';

const url = process.env['TEST_DATABASE_URL'];
const identityUrl = process.env['TEST_IDENTITY_DATABASE_URL'];
const repoRoot = fileURLToPath(new URL('../../..', import.meta.url));

const sink = new Writable({
  write(_c, _e, cb) {
    cb();
  },
});

describe.skipIf(!url)('Phase 6 acceptance', () => {
  let db: DbHandle;
  let app: App;
  let world: WorldModelService;
  let storeRoot: string;
  let auth: { authorization: string };
  let tenantId: string;
  let userId: string;

  const userSource = (at = new Date()): FactSource =>
    ({ kind: 'user', stated_at: at.toISOString() }) as FactSource;

  const get = (url: string, headers = auth) => app.inject({ method: 'GET', url, headers });

  const brief = async (headers = auth): Promise<DailyBrief> =>
    (await get('/v1/brief', headers)).json<DailyBrief>();

  beforeAll(async () => {
    const dbConfig = {
      url: url!,
      identityUrl,
      maxConnections: 10,
      identityMaxConnections: 2,
      idleTimeoutMillis: 5_000,
      connectionTimeoutMillis: 5_000,
      statementTimeoutMillis: 20_000,
      applicationName: 'astra-acceptance6',
    };
    db = createDb(dbConfig);
    storeRoot = await mkdtemp(path.join(tmpdir(), 'astra-acceptance6-'));
    world = new WorldModelService({ db });

    app = buildApp({
      config: {
        env: 'test',
        port: 0,
        host: '127.0.0.1',
        logLevel: 'silent',
        redisUrl: undefined,
        version: '0.1.0',
        db: dbConfig,
        builtinPluginsDir: path.join(repoRoot, 'plugins/builtin'),
        objectStoreRoot: storeRoot,
        recordingRoot: storeRoot,
        allowedOrigins: [],
        shareHost: 'http://localhost:1430',
        requesterSalt: 'acceptance6-salt',
      },
      db,
      redis: null,
      rateLimiter: new MemoryRateLimiter(),
      logger: createLogger({ service: 'acceptance6', level: 'silent' }, sink),
      tokens: new JwtTokens({
        issuer: 'https://auth.astra.test',
        keys: await loadSigningKeys({ keyId: 'acceptance6' }),
      }),
      tasks: new TaskService(db, new InMemoryTaskRuntime()),
      library: new LibraryService(db, new FsObjectStore(storeRoot)),
      registry: new PluginRegistryService({ db, coreVersion: '0.1.0' }),
      world,
      ssePollIntervalMs: 20,
    });
    await app.ready();

    const issued = await app.inject({
      method: 'POST',
      url: '/v1/auth/dev/token',
      payload: { email: `ac6-${uuidv7()}@example.com`, display_name: 'Acceptance 6' },
    });
    auth = { authorization: `Bearer ${issued.json<TokenResponse>().access_token}` };
    const me = (await get('/v1/me')).json<{ tenant: { id: string }; user: { id: string } }>();
    tenantId = me.tenant.id;
    userId = me.user.id;
  }, 180_000);

  afterAll(async () => {
    await app?.close();
    await db?.close();
    if (storeRoot) await rm(storeRoot, { recursive: true, force: true });
  });

  it('AC6-2: a commitment with nothing to point at is not created', async () => {
    const result = await world.remember(tenantId, {
      kind: 'commitment',
      statement: '出所のない約束',
      source: null,
    });
    expect(result.fact).toBeNull();
    // 黙って捨てない。なぜ覚えていないのかを言う。
    expect(result.skipped).toContain('source');
  });

  it('AC6-7: it keeps only what the policy lists', async () => {
    const chat = await world.remember(tenantId, {
      kind: 'small_talk',
      statement: '今日は暑いですね',
      source: userSource(),
    });
    expect(chat.fact).toBeNull();

    const preference = await world.remember(tenantId, {
      kind: 'preference',
      statement: '報告は結論から書いてほしい',
      source: userSource(),
    });
    expect(preference.fact).not.toBeNull();
  });

  it('AC6-1: a commitment carries where it came from', async () => {
    const at = new Date();
    const { fact } = await world.remember(tenantId, {
      kind: 'commitment',
      statement: '見積を明日送る',
      source: userSource(at),
      dueAt: new Date(Date.now() + 86_400_000).toISOString(),
    });
    expect(fact!.source).toMatchObject({ kind: 'user' });

    const listed = (await get('/v1/commitments')).json<{ items: WorldFact[] }>();
    const found = listed.items.find((c) => c.id === fact!.id)!;
    // どこから来たかが HTTP でも見える
    expect(found.source).toMatchObject({ kind: 'user' });
  });

  it('AC6-8: the same person does not become two entities', async () => {
    const a = await world.observe(tenantId, 'person', '田中 太郎');
    const b = await world.observe(tenantId, 'person', '田中太郎さん');
    expect(b.id).toBe(a.id);
    expect(b.mention_count).toBeGreaterThan(a.mention_count - 1);
  });

  it('AC6-4: what is overdue comes before what is merely due', async () => {
    await world.remember(tenantId, {
      kind: 'commitment',
      statement: '期限を過ぎた仕事',
      source: userSource(new Date(Date.now() - 5 * 86_400_000)),
      dueAt: new Date(Date.now() - 3 * 86_400_000).toISOString(),
    });

    const result = await brief();
    const titles = [...result.attention, ...result.more].map((i) => i.title);
    const overdue = titles.indexOf('期限を過ぎた仕事');
    const later = titles.indexOf('見積を明日送る');
    expect(overdue).toBeGreaterThanOrEqual(0);
    if (later >= 0) expect(overdue).toBeLessThan(later);
  });

  it('AC6-9: every item in the brief says what to do and where to go', async () => {
    const result = await brief();
    for (const item of [...result.attention, ...result.more]) {
      expect(item.action_label.length).toBeGreaterThan(0);
      expect(item.target).toBeDefined();
      // 「気にしたほうがよい」だけでは、何を見ればよいか分からない
      expect(item.score).toBeGreaterThan(0);
    }
  });

  it('AC6-5: it never puts more than three things in front of the user', async () => {
    for (let i = 0; i < 8; i += 1) {
      await world.remember(tenantId, {
        kind: 'commitment',
        statement: `やること ${i}`,
        source: userSource(new Date(Date.now() - i * 1_000)),
        dueAt: new Date(Date.now() - i * 86_400_000).toISOString(),
      });
    }
    const result = await brief();
    expect(result.attention.length).toBeLessThanOrEqual(MAX_ATTENTION_ITEMS);
    // 4 件目以降は消えるのではなく「すべて見る」へ
    expect(result.more.length).toBeGreaterThan(0);
  });

  it('AC6-3: a settled commitment stops showing up', async () => {
    const before = await brief();
    const target = before.attention[0]!;
    expect(target.target.kind).toBe('commitment');
    const factId = (target.target as { fact_id: string }).fact_id;

    const settled = await app.inject({
      method: 'POST',
      url: `/v1/commitments/${factId}/settle`,
      headers: auth,
      payload: { status: 'DONE' },
    });
    expect(settled.statusCode).toBe(200);

    const after = await brief();
    expect([...after.attention, ...after.more].map((i) => i.id)).not.toContain(target.id);
  });

  it('AC6-6: it stays quiet about things that are not worth interrupting for', async () => {
    // 済んだ知らせを、いつまでも出し続けない
    const result = await brief();
    const stale = [...result.attention, ...result.more].filter((i) => i.detail === '終わりました');
    expect(stale).toEqual([]);
  });

  it('UI/UX §16: a refusal is remembered, not just acted on once', async () => {
    // 覚えない dismiss は、拒否ではなく無視
    const before = await brief();
    const target = before.attention[0];
    expect(target).toBeDefined();

    const dismissed = await app.inject({
      method: 'POST',
      url: `/v1/brief/items/${encodeURIComponent(target!.id)}/dismiss`,
      headers: auth,
      payload: { verdict: 'never' },
    });
    expect(dismissed.statusCode).toBe(204);

    const after = await brief();
    // 「すべて見る」にも出ない。押した意味が無くなる。
    expect([...after.attention, ...after.more].map((i) => i.id)).not.toContain(target!.id);

    // もう一度引いても戻ってこない
    const again = await brief();
    expect([...again.attention, ...again.more].map((i) => i.id)).not.toContain(target!.id);
  });

  it('UI/UX §16: a refusal belongs to the person who made it', async () => {
    const before = await brief();
    const target = before.attention[0];
    expect(target).toBeDefined();
    await app.inject({
      method: 'POST',
      url: `/v1/brief/items/${encodeURIComponent(target!.id)}/dismiss`,
      headers: auth,
      payload: { verdict: 'never' },
    });

    // 断った本人には残っている
    const mine = await world.attentionFeedback(tenantId, userId);
    expect(mine.map((f) => f.itemId)).toContain(target!.id);
    // 同じテナントの別の人には及ばない。一人の拒否で全員を黙らせない。
    expect(await world.attentionFeedback(tenantId, uuidv7())).toEqual([]);
  });

  it('AC6-10: another tenant sees none of this world', async () => {
    const outsider = await app.inject({
      method: 'POST',
      url: '/v1/auth/dev/token',
      payload: { email: `ot6-${uuidv7()}@example.com`, display_name: 'OT' },
    });
    const headers = { authorization: `Bearer ${outsider.json<TokenResponse>().access_token}` };

    expect((await get('/v1/commitments', headers)).json()).toEqual({ items: [] });
    const theirs = await brief(headers);
    expect([...theirs.attention, ...theirs.more]).toEqual([]);
  });
});
