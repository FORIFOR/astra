/**
 * 正本 §25 Conversation。
 *
 * 短い会話なら、たいてい何でも動く。**壊れるのは長くなってから**なので、
 * 30 turn 続けたときに何が起きるかをここで見る。
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Writable } from 'node:stream';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  COMPACTION_BATCH,
  RECENT_TURN_WINDOW,
  uuidv7,
  type ConversationState,
  type TokenResponse,
  type Turn,
} from '@astra/contracts';
import { createDb, type DbHandle } from '@astra/db';
import { createLogger } from '@astra/telemetry';
import { FsObjectStore, LibraryService } from '@astra/service-library';
import { PluginRegistryService } from '@astra/service-plugin-registry';
import { ConversationService } from '@astra/service-conversation';
import { InMemoryTaskRuntime, TaskService } from '@astra/service-task';
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

describe.skipIf(!url)('a conversation that goes on for a while', () => {
  let db: DbHandle;
  let app: App;
  let conversations: ConversationService;
  let storeRoot: string;
  let auth: { authorization: string };
  let tenantId: string;
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
      applicationName: 'astra-conversation-eval',
    };
    db = createDb(dbConfig);
    storeRoot = await mkdtemp(path.join(tmpdir(), 'astra-conv-eval-'));
    conversations = new ConversationService({ db });

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
        requesterSalt: 'conv-eval-salt',
      },
      db,
      redis: null,
      rateLimiter: new MemoryRateLimiter(),
      logger: createLogger({ service: 'conv-eval', level: 'silent' }, sink),
      tokens: new JwtTokens({
        issuer: 'https://auth.astra.test',
        keys: await loadSigningKeys({ keyId: 'conv-eval' }),
      }),
      tasks: new TaskService(db, new InMemoryTaskRuntime()),
      library: new LibraryService(db, new FsObjectStore(storeRoot)),
      registry: new PluginRegistryService({ db, coreVersion: '0.1.0' }),
      conversations,
      ssePollIntervalMs: 20,
    });
    await app.ready();

    const issued = await post(
      '/v1/auth/dev/token',
      { email: `conv-${uuidv7()}@example.com`, display_name: 'Conv' },
      {} as never,
    );
    auth = { authorization: `Bearer ${issued.json<TokenResponse>().access_token}` };
    tenantId = (await get('/v1/me')).json<{ tenant: { id: string } }>().tenant.id;
    conversationId = (await post('/v1/conversations', { title: '長い相談' })).json<{
      id: string;
    }>().id;
  }, 180_000);

  afterAll(async () => {
    await app?.close();
    await db?.close();
    if (storeRoot) await rm(storeRoot, { recursive: true, force: true });
  });

  it('still resolves "それ" after 30 turns', async () => {
    const artifactId = uuidv7();
    await post(`/v1/conversations/${conversationId}/referents`, {
      label: 'Q4提案',
      target: { kind: 'artifact', artifact_id: artifactId },
    });

    /*
     * 30 turn 続ける。話題は変わるが、指した先は覚えている。
     *
     * 発話に序数（「3番目」）を混ぜないのは、それ自体が指示語だから。
     * 一覧を出していないのに「3番目」と言えば、聞き返すのが正しい。
     */
    const topics = ['価格', '納期', '保守', '体制', '事例'];
    for (let i = 0; i < 30; i += 1) {
      const said = await say(`${topics[i % topics.length]!}について話します`);
      expect(said.statusCode, `turn ${i}`).toBe(202);
    }

    const resolved = await say('それを共有して');
    expect(resolved.statusCode).toBe(202);
    expect(resolved.json<{ needs_clarification: boolean }>().needs_clarification).toBe(false);
  }, 120_000);

  it('folds the older turns instead of carrying all thirty forever', async () => {
    const summary = await conversations.compact(
      tenantId,
      conversationId,
      async (turns) => `${turns.length} 件のやりとり`,
    );
    expect(summary).not.toBeNull();
    expect(summary!.turn_count).toBe(COMPACTION_BATCH);

    const view = (await get(`/v1/conversations/${conversationId}`)).json<{
      turns: Turn[];
      summaries: unknown[];
    }>();
    // 直近だけ持つ。畳んだことは残る。
    expect(view.turns.length).toBeLessThanOrEqual(RECENT_TURN_WINDOW);
    expect(view.summaries).toHaveLength(1);
  });

  it('changes what it is about when the topic changes', async () => {
    expect((await say('競合を調べて')).json<{ intent: string }>().intent).toBe('looking_up');
    expect((await say('見積を送信して')).json<{ intent: string }>().intent).toBe('doing');
    expect((await say('ありがとう')).json<{ intent: string }>().intent).toBe('talking');
  });

  it('keeps voice and typing in the same conversation', async () => {
    await say('声で言いました', { modality: 'voice' });
    await say('打って言いました', { modality: 'text' });

    const view = (await get(`/v1/conversations/${conversationId}`)).json<{ turns: Turn[] }>();
    const recent = view.turns.slice(-2);
    // 入力様式は属性でしかない（正本 §2）
    expect(recent.map((t) => t.modality)).toEqual(['voice', 'text']);
  });

  it('cuts off an answer that is no longer wanted, without erasing it', async () => {
    await conversations.append({
      tenantId,
      conversationId,
      role: 'assistant',
      modality: 'text',
      text: '長い答えを書き始めたところ',
    });

    // 新しい入力が来たら打ち切る
    await say('やっぱり別のことを頼みたい');

    const view = (await get(`/v1/conversations/${conversationId}`)).json<{ turns: Turn[] }>();
    const interrupted = view.turns.filter((t) => t.interrupted);
    expect(interrupted.length).toBeGreaterThan(0);
    // 出した分は残る。消すと何が起きたか分からない。
    expect(interrupted.some((t) => t.text.includes('長い答え'))).toBe(true);
  });

  it('does not pretend to know what "昨日の続き" means', async () => {
    const said = await say('昨日の続きをやって');
    // 直近を当てにいかない。時間で遡る材料が無い。
    expect(said.statusCode).toBe(200);
    expect(said.json<{ needs_clarification: boolean }>().needs_clarification).toBe(true);
  });

  it('keeps the state consistent through all of it', async () => {
    const view = (await get(`/v1/conversations/${conversationId}`)).json<{
      state: ConversationState;
    }>();
    expect(view.state.referents.length).toBeGreaterThan(0);
    // 積み上がり続けない
    expect(view.state.referents.length).toBeLessThanOrEqual(20);
  });
});
