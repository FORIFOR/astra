/**
 * 正本 §30 Case B。
 *
 *   「この会議を記録して英語も出して」
 *   → speaker-separated live transcript → realtime translation → final minutes
 *
 * Case A と同じく**切らずに通す**。
 * 合格の基準は「機能が動いた」ではなく、
 * **会議が終わったときに、読める議事録が手元に残ったか**。
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Writable } from 'node:stream';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TestWorkflowEnvironment } from '@temporalio/testing';
import type { Worker } from '@temporalio/worker';
import {
  uuidv7,
  type Artifact,
  type Meeting,
  type MeetingSegment,
  type Task,
  type TokenResponse,
} from '@astra/contracts';
import { createDb, type DbHandle } from '@astra/db';
import { createLogger } from '@astra/telemetry';
import { FsObjectStore, LibraryService } from '@astra/service-library';
import { PluginRegistryService } from '@astra/service-plugin-registry';
import { ConversationService } from '@astra/service-conversation';
import {
  KeywordSummarizer,
  MeetingService,
  MemoryRecordingStore,
  ScriptedBatchTranscriber,
  ScriptedStreamingTranscriber,
  meetingExecutors,
  type ScriptLine,
} from '@astra/service-meeting';
import {
  TaskService,
  TemporalTaskRuntime,
  createTaskWorker,
  workflowIdFor,
} from '@astra/service-task';
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
const TASK_QUEUE = 'astra.task.case-b';

const sink = new Writable({
  write(_c, _e, cb) {
    cb();
  },
});

/** 3 人。live では言い間違い、final で直る。 */
const SCRIPT: ScriptLine[] = [
  {
    speakerTag: 1,
    text: '初期ひようが気になっています',
    finalText: '初期費用が気になっています',
    startMs: 0,
    endMs: 4_000,
  },
  { speakerTag: 2, text: '分割については対応します', startMs: 4_000, endMs: 8_000 },
  { speakerTag: 3, text: '導入時期はいつ頃でしょうか', startMs: 8_000, endMs: 12_000 },
  { speakerTag: 1, text: 'では10月で行きましょう', startMs: 12_000, endMs: 15_000 },
];

describe.skipIf(!url)('Case B — record it, and get minutes you can read', () => {
  let env: TestWorkflowEnvironment;
  let worker: Worker;
  let workerRun: Promise<void>;
  let db: DbHandle;
  let app: App;
  let library: LibraryService;
  let meetings: MeetingService;
  let recordings: MemoryRecordingStore;
  let storeRoot: string;
  let auth: { authorization: string };
  let tenantId: string;

  let conversationId: string;
  let meeting: Meeting;
  let finalizeTaskId: string;

  const post = (url: string, payload: unknown, headers = auth) =>
    app.inject({ method: 'POST', url, headers, payload: payload as never });
  const get = (url: string, headers = auth) => app.inject({ method: 'GET', url, headers });

  beforeAll(async () => {
    const dbConfig = {
      url: url!,
      identityUrl,
      maxConnections: 12,
      identityMaxConnections: 3,
      idleTimeoutMillis: 5_000,
      connectionTimeoutMillis: 5_000,
      statementTimeoutMillis: 20_000,
      applicationName: 'astra-case-b',
    };
    db = createDb(dbConfig);
    storeRoot = await mkdtemp(path.join(tmpdir(), 'astra-case-b-'));
    library = new LibraryService(db, new FsObjectStore(storeRoot));
    // 翻訳は代役。ここで見たいのは訳の質ではなく、**出る位置と単位**。
    meetings = new MeetingService({
      db,
      publisher: { async publish() {} },
      translator: {
        isStandIn: true,
        async translate(text) {
          return `EN: ${text}`;
        },
      },
    });
    recordings = new MemoryRecordingStore();

    env = await TestWorkflowEnvironment.createLocal();
    worker = await createTaskWorker(
      {
        db,
        library,
        publisher: { async publish() {} },
        executors: meetingExecutors({
          meetings,
          library,
          recordings,
          batch: new ScriptedBatchTranscriber(SCRIPT, 5),
          summarizer: new KeywordSummarizer(),
        }),
      },
      {
        connection: env.nativeConnection,
        namespace: env.client.options.namespace,
        taskQueue: TASK_QUEUE,
        workflowsPath: path.join(repoRoot, 'services/task/src/workflows.ts'),
      },
    );
    workerRun = worker.run();

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
        requesterSalt: 'case-b-salt',
      },
      db,
      redis: null,
      rateLimiter: new MemoryRateLimiter(),
      logger: createLogger({ service: 'case-b', level: 'silent' }, sink),
      tokens: new JwtTokens({
        issuer: 'https://auth.astra.test',
        keys: await loadSigningKeys({ keyId: 'case-b' }),
      }),
      tasks: new TaskService(db, new TemporalTaskRuntime(env.client, TASK_QUEUE)),
      library,
      registry: new PluginRegistryService({ db, coreVersion: '0.1.0' }),
      conversations: new ConversationService({ db }),
      meetings: {
        meetings,
        recordings,
        transcriber: new ScriptedStreamingTranscriber(SCRIPT),
      },
      ssePollIntervalMs: 20,
    });
    await app.ready();

    const issued = await post(
      '/v1/auth/dev/token',
      { email: `case-b-${uuidv7()}@example.com`, display_name: 'はじめての人' },
      {} as never,
    );
    auth = { authorization: `Bearer ${issued.json<TokenResponse>().access_token}` };
    tenantId = (await get('/v1/me')).json<{ tenant: { id: string } }>().tenant.id;
  }, 240_000);

  afterAll(async () => {
    worker?.shutdown();
    await workerRun?.catch(() => undefined);
    await app?.close();
    await env?.teardown();
    await db?.close();
    if (storeRoot) await rm(storeRoot, { recursive: true, force: true });
  });

  it('1. asking to record is understood as a meeting, not as a chore', async () => {
    conversationId = (await post('/v1/conversations', { title: 'A社 商談' })).json<{
      id: string;
    }>().id;

    const said = await post(`/v1/conversations/${conversationId}/turns`, {
      text: 'この会議を記録して英語も出して',
      context_referents: [{ label: 'A社 新規提案', kind: 'meeting' }],
    });
    expect(said.statusCode).toBe(202);
    const body = said.json<{ needs_clarification: boolean; intent: string }>();
    expect(body.needs_clarification).toBe(false);
    // 「会議の話だ」と分かる。モードは選ばせない。
    expect(body.intent).toBe('meeting');
  });

  it('2. starting it says what is being captured, and needs consent first', async () => {
    // 同意の確認なしには始まらない
    const without = await post('/v1/meetings', { title: 'A社 新規提案' });
    expect(without.statusCode).toBe(400);

    const started = await post('/v1/meetings', {
      title: 'A社 新規提案',
      consent_confirmed: true,
      audio_sources: ['microphone', 'system'],
      language: 'ja-JP',
      target_language: 'en-US',
    });
    expect(started.statusCode).toBe(201);
    meeting = started.json<Meeting>();
    expect(meeting.audio_sources).toEqual(['microphone', 'system']);
    expect(meeting.target_language).toBe('en-US');
  });

  it('3. the transcript comes out separated by speaker, as it happens', async () => {
    const session = await new ScriptedStreamingTranscriber(SCRIPT).start({ language: 'ja-JP' });
    for (let atMs = 0; atMs <= 15_000; atMs += 1_000) {
      const frame = new Uint8Array(3_200);
      await recordings.append(meeting.id, frame);
      await meetings.ingest(tenantId, meeting.id, await session.push(frame, atMs));
    }
    await meetings.ingest(tenantId, meeting.id, await session.finish());

    const { items } = (await get(`/v1/meetings/${meeting.id}/segments?pass=live`)).json<{
      items: MeetingSegment[];
    }>();

    // 3 人が別々に出る
    expect(new Set(items.map((s) => s.speaker_tag))).toEqual(new Set([1, 2, 3]));
    // 途中経過は残さない。確定だけ。
    expect(items.map((s) => s.text)).toContain('初期ひようが気になっています');
  });

  it('4. naming a speaker sticks for the rest of the meeting', async () => {
    const named = await post(`/v1/meetings/${meeting.id}/speakers`, {
      speaker_tag: 1,
      display_name: '田中',
    });
    expect(named.statusCode).toBe(200);

    const { speakers } = (await get(`/v1/meetings/${meeting.id}/segments`)).json<{
      speakers: { display_name: string }[];
    }>();
    expect(speakers.map((s) => s.display_name)).toEqual(['田中']);
  });

  it('5. the English comes per settled sentence, not per keystroke', async () => {
    const segments = await meetings.segments(tenantId, meeting.id, 'live');
    await meetings.translate(tenantId, meeting.id, segments[0]!, 'en-US');
    // 訳し直しても増えない
    await meetings.translate(tenantId, meeting.id, segments[0]!, 'en-US');

    const events = await meetings.eventsAfter(tenantId, meeting.id, 0);
    const translated = events.filter((e) => e.type === 'meeting.translation.final');
    expect(translated).toHaveLength(2);
    // 途中経過は訳さない。画面が揺れる。
    expect(
      events.some(
        (e) =>
          e.type === 'meeting.translation.final' &&
          String((e.payload as { segment_id: string }).segment_id).startsWith('partial:'),
      ),
    ).toBe(false);
  });

  it('6. stopping hands off to something that survives closing the window', async () => {
    const finished = await post(`/v1/meetings/${meeting.id}/finish`, {});
    expect(finished.statusCode).toBe(202);
    finalizeTaskId = finished.json<{ task_id: string }>().task_id;

    // 会議は「処理中」だと分かる
    expect((await get(`/v1/meetings/${meeting.id}`)).json<Meeting>().status).toBe('FINALIZING');

    await env.client.workflow.getHandle(workflowIdFor(tenantId, finalizeTaskId)).result();
    expect((await get(`/v1/tasks/${finalizeTaskId}`)).json<Task>().status).toBe('COMPLETED');
    await meetings.setStatus(tenantId, meeting.id, 'COMPLETE');
  }, 180_000);

  it('7. what was said live is not overwritten by the better version', async () => {
    const live = (await get(`/v1/meetings/${meeting.id}/segments?pass=live`)).json<{
      items: MeetingSegment[];
    }>().items;
    const final = (await get(`/v1/meetings/${meeting.id}/segments?pass=final`)).json<{
      items: MeetingSegment[];
    }>().items;

    // その場に見えていたものは残る
    expect(live.map((s) => s.text).join('')).toContain('初期ひようが');
    // 最終版では直っている
    expect(final.map((s) => s.text).join('')).toContain('初期費用が');
    // 名付けた人は、番号がずれても同じ人のまま
    expect(new Set(final.map((s) => s.speaker_tag))).toEqual(new Set([1, 2, 3]));
  });

  it('8. the minutes are readable, and every claim can be traced', async () => {
    const { items } = (await get('/v1/artifacts?limit=50')).json<{ items: Artifact[] }>();
    const bundle = items.find((a) => a.type === 'MEETING_BUNDLE');
    expect(bundle).toBeDefined();
    // どの会議のものか辿れる
    expect(bundle!.source_meeting_id).toBe(meeting.id);

    const content = await get(`/v1/artifacts/${bundle!.id}/content`);
    const text = content.body;

    // 結論が先、transcript は後ろ
    expect(text.indexOf('## 決定事項')).toBeLessThan(text.indexOf('## Transcript'));
    // 名付けた人は名前で出る
    expect(text).toContain('**田中**');

    const [head, transcript] = text.split('## Transcript');
    const lines = new Map(
      [...transcript!.matchAll(/^(\d+)\. `(\d\d:\d\d)` \*\*(.+?)\*\* (.+)$/gm)].map((m) => [
        m[1]!,
        m[2]!,
      ]),
    );
    const cited = [...head!.matchAll(/\[(\d+)\]/g)].map((m) => m[1]!);
    expect(cited.length).toBeGreaterThan(0);
    for (const n of cited) {
      // 跳べない引用を出さない
      expect(lines.has(n), `citation [${n}]`).toBe(true);
    }
  });

  it('9. the recording is kept, and it belongs to the meeting, not the task', async () => {
    const done = (await get(`/v1/meetings/${meeting.id}`)).json<Meeting>();
    expect(done.recording_artifact_id).not.toBeNull();

    const recording = (await get(`/v1/artifacts/${done.recording_artifact_id}`)).json<Artifact>();
    expect(recording.type).toBe('AUDIO');
    expect(recording.source_meeting_id).toBe(meeting.id);
    // 録音は finalize タスクの成果物ではない
    expect(recording.source_task_id).toBeNull();
  });
});
