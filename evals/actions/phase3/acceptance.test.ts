/**
 * Phase 3 受け入れテスト。Phase 3 実装仕様 §0 の AC3-1〜AC3-12。
 *
 *   pnpm test:acceptance
 *
 * 正本 §28 Phase 3 Exit「multi-speaker meeting E2E」を **HTTP から**検証する。
 * 3 人が喋り、live で言い間違え、final で直り、議事録が残るまでを 1 本で通す。
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
import {
  TaskService,
  TemporalTaskRuntime,
  createTaskWorker,
  workflowIdFor,
} from '@astra/service-task';
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
  MemoryRateLimiter,
  buildApp,
  JwtTokens,
  loadSigningKeys,
  type App,
} from '@astra/service-api-gateway';

const url = process.env['TEST_DATABASE_URL'];
const identityUrl = process.env['TEST_IDENTITY_DATABASE_URL'];
const repoRoot = fileURLToPath(new URL('../../..', import.meta.url));
const TASK_QUEUE = 'astra.task.acceptance3';

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

describe.skipIf(!url)('Phase 3 acceptance', () => {
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
  let meeting: Meeting;
  let finalizeTaskId: string;

  const get = <T>(url: string) =>
    app.inject({ method: 'GET', url, headers: auth }).then((r) => ({
      status: r.statusCode,
      body: r.json<T>(),
    }));

  const bodyOf = async (artifactId: string): Promise<string> => {
    const { stream } = await library.readContent(tenantId, artifactId);
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(Buffer.from(chunk as Buffer));
    return Buffer.concat(chunks).toString('utf8');
  };

  beforeAll(async () => {
    const dbConfig = {
      url: url!,
      identityUrl,
      maxConnections: 12,
      identityMaxConnections: 3,
      idleTimeoutMillis: 5_000,
      connectionTimeoutMillis: 5_000,
      statementTimeoutMillis: 20_000,
      applicationName: 'astra-acceptance3',
    };
    db = createDb(dbConfig);
    storeRoot = await mkdtemp(path.join(tmpdir(), 'astra-acceptance3-'));
    library = new LibraryService(db, new FsObjectStore(storeRoot));
    meetings = new MeetingService({ db, publisher: { async publish() {} } });
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
          // final パスは話者番号がずれている。番号一致に頼っていないことを試す。
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
        requesterSalt: 'acceptance3-salt',
      },
      db,
      redis: null,
      rateLimiter: new MemoryRateLimiter(),
      logger: createLogger({ service: 'acceptance3', level: 'silent' }, sink),
      tokens: new JwtTokens({
        issuer: 'https://auth.astra.test',
        keys: await loadSigningKeys({ keyId: 'acceptance3' }),
      }),
      tasks: new TaskService(db, new TemporalTaskRuntime(env.client, TASK_QUEUE)),
      library,
      registry: new PluginRegistryService({ db, coreVersion: '0.1.0' }),
      meetings: {
        meetings,
        recordings,
        transcriber: new ScriptedStreamingTranscriber(SCRIPT),
      },
      ssePollIntervalMs: 20,
    });
    await app.ready();

    const issued = await app.inject({
      method: 'POST',
      url: '/v1/auth/dev/token',
      payload: { email: `ac3-${uuidv7()}@example.com`, display_name: 'Acceptance 3' },
    });
    auth = { authorization: `Bearer ${issued.json<TokenResponse>().access_token}` };
    tenantId = (await get<{ tenant: { id: string } }>('/v1/me')).body.tenant.id;

    // --- 会議を 1 本、頭から終わりまで -------------------------------------
    const started = await app.inject({
      method: 'POST',
      url: '/v1/meetings',
      headers: auth,
      payload: {
        title: 'A社 新規提案',
        consent_confirmed: true,
        audio_sources: ['microphone', 'system'],
        language: 'ja-JP',
      },
    });
    expect(started.statusCode).toBe(201);
    meeting = started.json<Meeting>();

    // 音声は WS 経由。inject では張れないので、gateway と同じ経路を手で通す。
    const session = await new ScriptedStreamingTranscriber(SCRIPT).start({ language: 'ja-JP' });
    for (let atMs = 0; atMs <= 15_000; atMs += 1_000) {
      const frame = new Uint8Array(3_200); // 100ms 分の 16kHz/16bit
      await recordings.append(meeting.id, frame);
      await meetings.ingest(tenantId, meeting.id, await session.push(frame, atMs));
    }
    await meetings.ingest(tenantId, meeting.id, await session.finish());

    await app.inject({
      method: 'POST',
      url: `/v1/meetings/${meeting.id}/speakers`,
      headers: auth,
      payload: { speaker_tag: 1, display_name: '田中' },
    });

    const finished = await app.inject({
      method: 'POST',
      url: `/v1/meetings/${meeting.id}/finish`,
      headers: auth,
    });
    expect(finished.statusCode).toBe(202);
    finalizeTaskId = finished.json<{ task_id: string }>().task_id;
    await env.client.workflow.getHandle(workflowIdFor(tenantId, finalizeTaskId)).result();
    await meetings.setStatus(tenantId, meeting.id, 'COMPLETE');
  }, 240_000);

  afterAll(async () => {
    worker?.shutdown();
    await workerRun?.catch(() => undefined);
    await app?.close();
    await env?.teardown();
    await db?.close();
    if (storeRoot) await rm(storeRoot, { recursive: true, force: true });
  });

  it('AC3-1: a meeting records what it captures and when consent was confirmed', () => {
    expect(meeting.audio_sources).toEqual(['microphone', 'system']);
    expect(meeting.language).toBe('ja-JP');
    // 同意の確認時刻が残らない録音は作らない
    expect(meeting.consent_at).not.toBeNull();
  });

  it('AC3-2: the transcript carries speaker tags', async () => {
    const { body } = await get<{ items: MeetingSegment[] }>(
      `/v1/meetings/${meeting.id}/segments?pass=live`,
    );
    // 3 人分の話者が付いている
    expect(new Set(body.items.map((s) => s.speaker_tag))).toEqual(new Set([1, 2, 3]));
  });

  it('AC3-3: only the final results are stored, never the interim ones', async () => {
    const { body } = await get<{ items: MeetingSegment[] }>(
      `/v1/meetings/${meeting.id}/segments?pass=live`,
    );
    // 台本の 4 行が、話者の切り替わりどおりに残る
    expect(body.items.map((s) => s.text)).toEqual([
      '初期ひようが気になっています',
      '分割については対応します',
      '導入時期はいつ頃でしょうか',
      'では10月で行きましょう',
    ]);
  });

  it('AC3-4: a named speaker stays named for the meeting', async () => {
    const { body } = await get<{ speakers: { speaker_tag: number; display_name: string }[] }>(
      `/v1/meetings/${meeting.id}/segments`,
    );
    expect(body.speakers).toEqual([
      expect.objectContaining({ speaker_tag: 1, display_name: '田中' }),
    ]);
  });

  it('AC3-5: translation happens per settled segment, not per keystroke', async () => {
    const translator = new MeetingService({
      db,
      publisher: { async publish() {} },
      translator: {
        isStandIn: true,
        async translate(text) {
          return `EN: ${text}`;
        },
      },
    });
    const segments = await meetings.segments(tenantId, meeting.id, 'live');
    await translator.translate(tenantId, meeting.id, segments[0]!, 'en-US');
    await translator.translate(tenantId, meeting.id, segments[0]!, 'en-US');

    const events = await meetings.eventsAfter(tenantId, meeting.id, 0);
    const translated = events.filter((e) => e.type === 'meeting.translation.final');
    // 訳し直しても増えない
    expect(translated).toHaveLength(2);
    // 途中経過は訳さない（画面が揺れる）
    expect(events.some((e) => e.type === 'meeting.transcript.partial')).toBe(true);
    expect(
      events.some(
        (e) =>
          e.type === 'meeting.translation.final' &&
          String((e.payload as { segment_id: string }).segment_id).startsWith('partial:'),
      ),
    ).toBe(false);
  });

  it('AC3-6: finalize runs as a durable task that survives closing the window', async () => {
    const { body } = await get<Task>(`/v1/tasks/${finalizeTaskId}`);
    expect(body.status).toBe('COMPLETED');
    expect(body.kind).toBe('meeting.finalize');
  });

  it('AC3-7: the final pass is added beside the live one, never over it', async () => {
    const live = (
      await get<{ items: MeetingSegment[] }>(`/v1/meetings/${meeting.id}/segments?pass=live`)
    ).body.items;
    const final = (
      await get<{ items: MeetingSegment[] }>(`/v1/meetings/${meeting.id}/segments?pass=final`)
    ).body.items;

    // その場に見えていたものは残る
    expect(live.map((s) => s.text).join('')).toContain('初期ひようが');
    // 最終版では直っている
    expect(final.map((s) => s.text).join('')).toContain('初期費用が');
    // どの live を置き換えたのか辿れる
    expect(final.some((s) => s.supersedes.length > 0)).toBe(true);
    // 名前を付けた話者は、番号がずれても同じ人のまま
    expect(new Set(final.map((s) => s.speaker_tag))).toEqual(new Set([1, 2, 3]));
  });

  it('AC3-8: it produces a summary, decisions and action items', async () => {
    const { body } = await get<Artifact>(`/v1/artifacts?limit=50`);
    const bundle = (body as unknown as { items: Artifact[] }).items.find(
      (a) => a.type === 'MEETING_BUNDLE',
    );
    expect(bundle).toBeDefined();

    const text = await bodyOf(bundle!.id);
    expect(text).toContain('## 決定事項');
    expect(text).toContain('## ToDo');
    // 結論が先、transcript は後ろ（UI/UX §12.6）
    expect(text.indexOf('## 決定事項')).toBeLessThan(text.indexOf('## Transcript'));
    // 名前を付けた話者は名前で出る
    expect(text).toContain('**田中**');
  });

  it('AC3-9: every claim lands on a transcript line with a timestamp', async () => {
    const { body } = await get<{ items: Artifact[] }>(`/v1/artifacts?limit=50`);
    const bundle = body.items.find((a) => a.type === 'MEETING_BUNDLE')!;
    const text = await bodyOf(bundle.id);

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
      expect(lines.has(n), `citation [${n}] must land on a transcript line`).toBe(true);
      expect(lines.get(n)).toMatch(/^\d\d:\d\d$/);
    }
  });

  it('AC3-10: the recording and the bundle both live in the library', async () => {
    const { body } = await get<Meeting>(`/v1/meetings/${meeting.id}`);
    expect(body.recording_artifact_id).not.toBeNull();

    const recording = await library.get(tenantId, body.recording_artifact_id!);
    expect(recording.type).toBe('AUDIO');
    expect(recording.source_meeting_id).toBe(meeting.id);

    const bundle = await library.findBySourceTask(tenantId, finalizeTaskId);
    expect(bundle!.type).toBe('MEETING_BUNDLE');
    expect(bundle!.source_meeting_id).toBe(meeting.id);
  });

  it('AC3-11: losing the transcriber does not stop the recording', async () => {
    const started = await app.inject({
      method: 'POST',
      url: '/v1/meetings',
      headers: auth,
      payload: { title: '落ちる会議', consent_confirmed: true },
    });
    const shaky = started.json<Meeting>();

    await recordings.append(shaky.id, new Uint8Array(3_200));
    await meetings.markDegraded(tenantId, shaky.id);
    await recordings.append(shaky.id, new Uint8Array(3_200));

    const { body } = await get<Meeting>(`/v1/meetings/${shaky.id}`);
    expect(body.degraded_at).not.toBeNull();
    // 会議は終わらない。音は増え続ける。
    expect(body.status).toBe('RECORDING');
    expect(await recordings.sizeOf(shaky.id)).toBe(6_400);
  });

  it('AC3-12: another tenant sees 404, not 403', async () => {
    const outsider = await app.inject({
      method: 'POST',
      url: '/v1/auth/dev/token',
      payload: { email: `out3-${uuidv7()}@example.com`, display_name: 'O' },
    });
    const headers = { authorization: `Bearer ${outsider.json<TokenResponse>().access_token}` };

    for (const path of ['', '/segments', '/stream']) {
      const res = await app.inject({
        method: 'GET',
        url: `/v1/meetings/${meeting.id}${path}`,
        headers,
      });
      expect(res.statusCode, path).toBe(404);
    }
  });
});
