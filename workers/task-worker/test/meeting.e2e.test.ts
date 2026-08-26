/**
 * 会議の縦串。正本 §11・§13、Phase 3 実装仕様 §5。AC3-6 〜 AC3-10。
 *   ./infra/db/with-test-db.sh pnpm --filter @astra/worker-task test
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TestWorkflowEnvironment } from '@temporalio/testing';
import type { Worker } from '@temporalio/worker';
import { uuidv7 } from '@astra/contracts';
import { createDb, withIdentity, type DbHandle } from '@astra/db';
import { FsObjectStore, LibraryService } from '@astra/service-library';
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

const url = process.env['TEST_DATABASE_URL'];
const identityUrl = process.env['TEST_IDENTITY_DATABASE_URL'];
const TASK_QUEUE = 'astra.task.meeting-test';

/** live では言い間違い、final で直る。dual path の意味がここに出る。 */
const SCRIPT: ScriptLine[] = [
  {
    speakerTag: 1,
    text: '初期ひようが気になっています',
    finalText: '初期費用が気になっています',
    startMs: 0,
    endMs: 4_000,
  },
  {
    speakerTag: 2,
    text: '分割については対応します',
    startMs: 4_000,
    endMs: 8_000,
  },
  {
    speakerTag: 1,
    text: '導入時期は10月で決定でよいですか',
    startMs: 8_000,
    endMs: 13_000,
  },
  {
    speakerTag: 2,
    text: 'では10月で行きましょう',
    startMs: 13_000,
    endMs: 16_000,
  },
];

describe.skipIf(!url)('meeting end to end', () => {
  let env: TestWorkflowEnvironment;
  let worker: Worker;
  let workerRun: Promise<void>;
  let db: DbHandle;
  let library: LibraryService;
  let meetings: MeetingService;
  let tasks: TaskService;
  let recordings: MemoryRecordingStore;
  let storeRoot: string;

  const tenantId = uuidv7();
  const userId = uuidv7();
  let meetingId: string;
  let taskId: string;

  beforeAll(async () => {
    db = createDb({
      url: url!,
      identityUrl,
      maxConnections: 10,
      identityMaxConnections: 2,
      idleTimeoutMillis: 5_000,
      connectionTimeoutMillis: 5_000,
      statementTimeoutMillis: 20_000,
      applicationName: 'astra-meeting-e2e',
    });

    await withIdentity(db, async (tx) => {
      await tx
        .insertInto('tenants')
        .values({ id: tenantId, name: 'M', kind: 'personal' })
        .execute();
      await tx
        .insertInto('users')
        .values({ id: userId, email: `me-${userId}@example.com`, display_name: 'M' })
        .execute();
      await tx
        .insertInto('memberships')
        .values({ tenant_id: tenantId, user_id: userId, role: 'owner' })
        .execute();
    });

    storeRoot = await mkdtemp(path.join(tmpdir(), 'astra-meeting-'));
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
          // final パスは live と話者番号がずれている。番号一致に頼っていないことを試す。
          batch: new ScriptedBatchTranscriber(SCRIPT, 4),
          summarizer: new KeywordSummarizer(),
        }),
      },
      {
        connection: env.nativeConnection,
        namespace: env.client.options.namespace,
        taskQueue: TASK_QUEUE,
        workflowsPath: fileURLToPath(
          new URL('../../../services/task/src/workflows.ts', import.meta.url),
        ),
      },
    );
    workerRun = worker.run();
    tasks = new TaskService(db, new TemporalTaskRuntime(env.client, TASK_QUEUE));

    // --- 会議を丸ごと 1 本回す -------------------------------------------
    const meeting = await meetings.start({
      tenantId,
      userId,
      title: 'A社 新規提案',
      language: 'ja-JP',
      targetLanguage: null,
      audioSources: ['microphone', 'system'],
    });
    meetingId = meeting.id;

    const stream = await new ScriptedStreamingTranscriber(SCRIPT).start({ language: 'ja-JP' });
    for (let atMs = 0; atMs <= 16_000; atMs += 1_000) {
      const frame = new Uint8Array(3_200); // 100ms 分の 16kHz/16bit
      await recordings.append(meetingId, frame);
      await meetings.ingest(tenantId, meetingId, await stream.push(frame, atMs));
    }
    await meetings.ingest(tenantId, meetingId, await stream.finish());
    await meetings.nameSpeaker(tenantId, meetingId, userId, 1, '田中');

    const { task } = await tasks.create({
      tenantId,
      userId,
      request: {
        kind: 'meeting.finalize',
        input: { meeting_id: meetingId, title: meeting.title },
      },
      idempotencyKey: `m-${uuidv7()}`,
    });
    taskId = task.id;
    await meetings.setStatus(tenantId, meetingId, 'FINALIZING');
    await meetings.recordBundle(tenantId, meetingId, { finalizeTaskId: taskId });
    await env.client.workflow.getHandle(workflowIdFor(tenantId, taskId)).result();
    await meetings.setStatus(tenantId, meetingId, 'COMPLETE');
  }, 240_000);

  afterAll(async () => {
    worker?.shutdown();
    await workerRun?.catch(() => undefined);
    await env?.teardown();
    await db?.close();
    if (storeRoot) await rm(storeRoot, { recursive: true, force: true });
  });

  it('AC3-6: finalize runs as a durable task that outlives the window', async () => {
    const done = await tasks.get(tenantId, taskId);
    expect(done.status).toBe('COMPLETED');
    // 会議のために別の仕組みを作らない（D-28）
    expect(done.kind).toBe('meeting.finalize');
  });

  it('AC3-7: the final pass never rewrites what was shown live', async () => {
    const live = await meetings.segments(tenantId, meetingId, 'live');
    const final = await meetings.segments(tenantId, meetingId, 'final');

    // live には言い間違いがそのまま残る
    expect(live.map((s) => s.text).join('')).toContain('初期ひようが');
    // final では直っている
    expect(final.map((s) => s.text).join('')).toContain('初期費用が');
    // どの live を置き換えたのか辿れる
    expect(final.some((s) => s.supersedes.length > 0)).toBe(true);
    // 話者は時間で対応を取るので、名前を付けた 1 番が final でも 1 番のまま
    expect(new Set(final.map((s) => s.speaker_tag))).toEqual(new Set([1, 2]));
  });

  it('AC3-8: it produces a summary, decisions and action items', async () => {
    const artifact = await library.findBySourceTask(tenantId, taskId);
    expect(artifact).not.toBeNull();
    expect(artifact!.type).toBe('MEETING_BUNDLE');

    const { stream } = await library.readContent(tenantId, artifact!.id);
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(Buffer.from(chunk as Buffer));
    const body = Buffer.concat(chunks).toString('utf8');

    expect(body).toContain('## 決定事項');
    expect(body).toContain('## ToDo');
    // 結論が先、transcript は後ろ（UI/UX §12.6）
    expect(body.indexOf('## 決定事項')).toBeLessThan(body.indexOf('## Transcript'));
    // 名前を付けた話者は名前で出る
    expect(body).toContain('田中');
  });

  it('AC3-9: every claim can be traced back to a segment and a timestamp', async () => {
    // step の結果はイベントに載せない（payload を漏らさないため）。
    // 引用が辿れることは、**ユーザーが実際に見る議事録本文**で確かめる。
    const artifact = await library.findBySourceTask(tenantId, taskId);
    const { stream } = await library.readContent(tenantId, artifact!.id);
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(Buffer.from(chunk as Buffer));
    const body = Buffer.concat(chunks).toString('utf8');

    const [head, transcript] = body.split('## Transcript');
    expect(transcript, 'the bundle must carry the transcript it cites').toBeDefined();

    // transcript の各行は「番号 + timestamp + 話者 + 本文」
    const lines = new Map(
      [...transcript!.matchAll(/^(\d+)\. `(\d\d:\d\d)` \*\*(.+?)\*\* (.+)$/gm)].map((m) => [
        m[1]!,
        { at: m[2]!, who: m[3]!, text: m[4]! },
      ]),
    );
    expect(lines.size).toBeGreaterThan(0);

    // 結論側の [n] は、すべて transcript の行に着地する
    const cited = [...head!.matchAll(/\[(\d+)\]/g)].map((m) => m[1]!);
    expect(cited.length, 'claims must carry citations').toBeGreaterThan(0);
    for (const n of cited) {
      expect(lines.has(n), `citation [${n}] must land on a transcript line`).toBe(true);
      // 跳ぶ先には timestamp がある
      expect(lines.get(n)!.at).toMatch(/^\d\d:\d\d$/);
    }
  });

  it('AC3-10: the recording and the bundle both live in the library', async () => {
    const meeting = await meetings.get(tenantId, meetingId);
    expect(meeting.recording_artifact_id).not.toBeNull();

    const recording = await library.get(tenantId, meeting.recording_artifact_id!);
    expect(recording.type).toBe('AUDIO');
    // 録音は finalize タスクの成果物ではなく会議のもの
    expect(recording.source_task_id).toBeNull();
    expect(recording.source_meeting_id).toBe(meetingId);

    const bundle = await library.findBySourceTask(tenantId, taskId);
    expect(bundle!.source_meeting_id).toBe(meetingId);
  });
});
