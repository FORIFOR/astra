/**
 * Phase 7 受け入れテスト。正本 §6・§7、Phase 7 実装仕様 §0。
 *
 * この 2 つのエンジンで守りたいのは、どちらも「やらないこと」:
 *   - 生のローカルデータを外へ出さない
 *   - 分からない指示語を埋めない
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Writable } from 'node:stream';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { uuidv7, type ConversationState, type TokenResponse, type Turn } from '@astra/contracts';
import { createDb, type DbHandle } from '@astra/db';
import { createLogger } from '@astra/telemetry';
import { FsObjectStore, LibraryService } from '@astra/service-library';
import { PluginRegistryService } from '@astra/service-plugin-registry';
import { InMemoryTaskRuntime, TaskService } from '@astra/service-task';
import { ConversationService } from '@astra/service-conversation';
import { buildCapsule, decideEgress } from '@astra/service-context';
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

describe.skipIf(!url)('Phase 7 acceptance', () => {
  let db: DbHandle;
  let app: App;
  let storeRoot: string;
  let auth: { authorization: string };
  let conversationId: string;

  const post = (url: string, payload: unknown, headers = auth) =>
    app.inject({ method: 'POST', url, headers, payload: payload as never });
  const get = (url: string, headers = auth) => app.inject({ method: 'GET', url, headers });

  const say = (text: string, extra: Record<string, unknown> = {}) =>
    post(`/v1/conversations/${conversationId}/turns`, { text, ...extra });

  beforeAll(async () => {
    const dbConfig = {
      url: url!,
      identityUrl,
      maxConnections: 10,
      identityMaxConnections: 2,
      idleTimeoutMillis: 5_000,
      connectionTimeoutMillis: 5_000,
      statementTimeoutMillis: 20_000,
      applicationName: 'astra-acceptance7',
    };
    db = createDb(dbConfig);
    storeRoot = await mkdtemp(path.join(tmpdir(), 'astra-acceptance7-'));

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
        requesterSalt: 'acceptance7-salt',
      },
      db,
      redis: null,
      rateLimiter: new MemoryRateLimiter(),
      logger: createLogger({ service: 'acceptance7', level: 'silent' }, sink),
      tokens: new JwtTokens({
        issuer: 'https://auth.astra.test',
        keys: await loadSigningKeys({ keyId: 'acceptance7' }),
      }),
      tasks: new TaskService(db, new InMemoryTaskRuntime()),
      library: new LibraryService(db, new FsObjectStore(storeRoot)),
      registry: new PluginRegistryService({ db, coreVersion: '0.1.0' }),
      conversations: new ConversationService({ db }),
      ssePollIntervalMs: 20,
    });
    await app.ready();

    const issued = await post(
      '/v1/auth/dev/token',
      { email: `ac7-${uuidv7()}@example.com`, display_name: 'Acceptance 7' },
      {} as never,
    );
    auth = { authorization: `Bearer ${issued.json<TokenResponse>().access_token}` };

    const started = await post('/v1/conversations', { title: '相談' });
    conversationId = started.json<{ id: string }>().id;
  }, 180_000);

  afterAll(async () => {
    await app?.close();
    await db?.close();
    if (storeRoot) await rm(storeRoot, { recursive: true, force: true });
  });

  it('AC7-1: raw local data does not leave unless it was shared', () => {
    const local = {
      activeApp: 'Keynote',
      windowTitle: 'Q4提案.pptx — Keynote',
      selectedText: '来期の売上目標',
      currentUrl: 'https://intranet.example.com/secret',
      clipboard: 'パスワード: hunter2',
    };
    const capsule = buildCapsule({ intent: '要約して', local });
    const serialized = JSON.stringify(capsule);
    expect(serialized).not.toContain('hunter2');
    expect(serialized).not.toContain('/secret');
    expect(capsule.selected_text).toBeNull();
  });

  it('AC7-3: the capsule takes the highest sensitivity it contains', () => {
    const capsule = buildCapsule({
      intent: 'x',
      sources: [
        {
          id: 'a',
          category: 'internal',
          label: '公開資料',
          reason: null,
          sensitivity: 'PUBLIC',
          removable: true,
          used: true,
        },
        {
          id: 'b',
          category: 'policy',
          label: '診療記録',
          reason: null,
          sensitivity: 'REGULATED',
          removable: false,
          used: true,
        },
      ] as never,
    });
    expect(capsule.sensitivity).toBe('REGULATED');
  });

  it('AC7-2: regulated context stays put while nothing can judge it', () => {
    const capsule = buildCapsule({
      intent: 'x',
      sources: [
        {
          id: 'b',
          category: 'policy',
          label: '診療記録',
          reason: null,
          sensitivity: 'REGULATED',
          removable: false,
          used: true,
        },
      ] as never,
    });
    const decision = decideEgress(capsule);
    expect(decision.allowed).toBe(false);
    expect(decision.capsule).toBeNull();
  });

  it('AC7-5: an unresolved pronoun is asked about, not guessed', async () => {
    const res = await say('それを共有して');
    expect(res.statusCode).toBe(200);
    const body = res.json<{ needs_clarification: boolean; answer: Turn }>();
    expect(body.needs_clarification).toBe(true);
    expect(body.answer.text).toContain('それ');
  });

  it('AC7-4: once something has been referred to, the pronoun resolves', async () => {
    const artifactId = uuidv7();
    const remembered = await post(`/v1/conversations/${conversationId}/referents`, {
      label: 'Q4提案',
      target: { kind: 'artifact', artifact_id: artifactId },
    });
    expect(remembered.statusCode).toBe(204);

    const res = await say('それを共有して');
    expect(res.statusCode).toBe(202);
    expect(res.json<{ needs_clarification: boolean }>().needs_clarification).toBe(false);
  });

  it('AC7-7: it does not ask again about what it already knows', async () => {
    // 直前で解決できているので、同じ言い方でもう一度聞き返さない
    const res = await say('それをもう一度見せて');
    expect(res.json<{ needs_clarification: boolean }>().needs_clarification).toBe(false);
  });

  it('AC7-6: the lane is decided from the input and never named to the user', async () => {
    const research = await say('競合を調べて');
    const body = research.json<Record<string, unknown>>();
    expect(body['intent']).toBe('looking_up');
    // 内部の Lane 名を配らない
    expect(JSON.stringify(body)).not.toContain('specialist-agent');
    expect(Object.keys(body)).not.toContain('lane');

    expect((await say('見積を送信して')).json<{ intent: string }>().intent).toBe('doing');
    expect((await say('こんにちは')).json<{ intent: string }>().intent).toBe('talking');
  });

  it('AC7-8: a new input cuts off the previous answer without erasing it', async () => {
    const cut = await say('やっぱり別のことを頼みたい');
    expect(cut.statusCode).toBe(202);

    const view = await get(`/v1/conversations/${conversationId}`);
    const turns = view.json<{ turns: Turn[] }>().turns;
    const interrupted = turns.filter((t) => t.interrupted);
    expect(interrupted.length).toBeGreaterThan(0);
    // 出した分は残っている
    expect(interrupted[0]!.text.length).toBeGreaterThan(0);
  });

  it('AC7-9: the state and the folded history come back together', async () => {
    const view = await get(`/v1/conversations/${conversationId}`);
    const body = view.json<{ state: ConversationState; turns: Turn[]; summaries: unknown[] }>();
    expect(body.state.referents.length).toBeGreaterThan(0);
    expect(body.turns.length).toBeGreaterThan(0);
    expect(Array.isArray(body.summaries)).toBe(true);
  });

  it('AC7-10: another tenant cannot see this conversation', async () => {
    const outsider = await post(
      '/v1/auth/dev/token',
      { email: `ot7-${uuidv7()}@example.com`, display_name: 'OT' },
      {} as never,
    );
    const headers = { authorization: `Bearer ${outsider.json<TokenResponse>().access_token}` };
    expect((await get(`/v1/conversations/${conversationId}`, headers)).statusCode).toBe(404);
  });
});
