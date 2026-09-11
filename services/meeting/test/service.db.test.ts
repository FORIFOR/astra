/**
 * MeetingService の DB 側。Phase 3 実装仕様 §3。
 *   ./infra/db/with-test-db.sh pnpm --filter @astra/service-meeting test
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { uuidv7 } from '@astra/contracts';
import { createDb, withIdentity, withTenant, type DbHandle } from '@astra/db';
import { MeetingService } from '../src/service.js';
import { EchoTranslationProvider, type TranscriptResult } from '../src/providers.js';

const url = process.env['TEST_DATABASE_URL'];
const identityUrl = process.env['TEST_IDENTITY_DATABASE_URL'];

const r = (over: Partial<TranscriptResult>): TranscriptResult => ({
  isFinal: true,
  speakerTag: 1,
  text: 'あ',
  startMs: 0,
  endMs: 1_000,
  language: 'ja-JP',
  confidence: 0.9,
  ...over,
});

describe.skipIf(!url)('MeetingService', () => {
  let db: DbHandle;
  let service: MeetingService;
  const tenantId = uuidv7();
  const otherTenantId = uuidv7();
  const userId = uuidv7();

  const startMeeting = (title = '定例') =>
    service.start({
      tenantId,
      userId,
      title,
      language: 'ja-JP',
      targetLanguage: 'en-US',
      audioSources: ['microphone'],
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
      applicationName: 'astra-meeting-test',
    });

    await withIdentity(db, async (tx) => {
      for (const id of [tenantId, otherTenantId]) {
        await tx.insertInto('tenants').values({ id, name: 'M', kind: 'personal' }).execute();
      }
      await tx
        .insertInto('users')
        .values({ id: userId, email: `m-${userId}@example.com`, display_name: 'M' })
        .execute();
      await tx
        .insertInto('memberships')
        .values({ tenant_id: tenantId, user_id: userId, role: 'owner' })
        .execute();
    });

    service = new MeetingService({
      db,
      publisher: { async publish() {} },
      translator: new EchoTranslationProvider(),
    });
  }, 60_000);

  afterAll(async () => {
    await db?.close();
  });

  it('starts recording with the consent time and audio sources on the record', async () => {
    const meeting = await startMeeting('A社 新規提案');
    expect(meeting.status).toBe('RECORDING');
    expect(meeting.audio_sources).toEqual(['microphone']);
    // 同意の確認時刻が残らない録音を作らない
    expect(meeting.consent_at).not.toBeNull();
    expect(meeting.degraded_at).toBeNull();
  });

  it('keeps only the final results, never the interim ones', async () => {
    const meeting = await startMeeting();
    await service.ingest(tenantId, meeting.id, [
      r({ isFinal: false, text: '途中の' }),
      r({ text: '確定した文', startMs: 0, endMs: 1_000 }),
    ]);
    const segments = await service.segments(tenantId, meeting.id);
    expect(segments.map((s) => s.text)).toEqual(['確定した文']);
    expect(segments.every((s) => s.pass === 'live')).toBe(true);
  });

  it('does not pile up duplicates when the same audio is replayed', async () => {
    const meeting = await startMeeting();
    const results = [r({ text: '一度だけ', startMs: 0, endMs: 500 })];
    await service.ingest(tenantId, meeting.id, results);
    await service.ingest(tenantId, meeting.id, results);
    expect(await service.segments(tenantId, meeting.id)).toHaveLength(1);
  });

  it('adds the final pass without touching what was shown live', async () => {
    const meeting = await startMeeting();
    await service.ingest(tenantId, meeting.id, [
      r({ speakerTag: 1, text: '初期ひようが', startMs: 0, endMs: 1_000 }),
      r({ speakerTag: 2, text: 'ぶんかつなら', startMs: 1_000, endMs: 2_000 }),
    ]);
    const live = await service.segments(tenantId, meeting.id, 'live');

    await service.applyFinalPass(tenantId, meeting.id, [
      // provider が違うので話者番号もずれている
      r({ speakerTag: 7, text: '初期費用が', startMs: 0, endMs: 1_000, confidence: 0.98 }),
      r({ speakerTag: 8, text: '分割なら', startMs: 1_000, endMs: 2_000, confidence: 0.98 }),
    ]);

    // live は一字も変わらない（D-25）
    expect(await service.segments(tenantId, meeting.id, 'live')).toEqual(live);

    const final = await service.segments(tenantId, meeting.id, 'final');
    expect(final.map((s) => s.text)).toEqual(['初期費用が', '分割なら']);
    // 話者は時間で対応を取るので、live の番号に揃う
    expect(final.map((s) => s.speaker_tag)).toEqual([1, 2]);
    // どの live を置き換えたかが辿れる
    expect(final[0]!.supersedes).toEqual([live[0]!.id]);
  });

  it('shows the final pass by default and falls back to live when there is none', async () => {
    const meeting = await startMeeting();
    await service.ingest(tenantId, meeting.id, [r({ text: 'ライブだけ' })]);
    expect((await service.segments(tenantId, meeting.id)).map((s) => s.pass)).toEqual(['live']);

    await service.applyFinalPass(tenantId, meeting.id, [r({ text: '確定版' })]);
    expect((await service.segments(tenantId, meeting.id)).map((s) => s.pass)).toEqual(['final']);
  });

  it('keeps a speaker name inside the meeting, and lets it be corrected', async () => {
    const meeting = await startMeeting();
    await service.nameSpeaker(tenantId, meeting.id, userId, 1, '田中');
    await service.nameSpeaker(tenantId, meeting.id, userId, 1, '田中 部長');
    const speakers = await service.speakers(tenantId, meeting.id);
    expect(speakers).toHaveLength(1);
    expect(speakers[0]!.display_name).toBe('田中 部長');

    // 別の会議には持ち越さない（声で人を特定しない。D-27）
    const another = await startMeeting();
    expect(await service.speakers(tenantId, another.id)).toEqual([]);
  });

  it('calls the translator once across concurrent services and persisted retries', async () => {
    const meeting = await startMeeting();
    const [segment] = await service.ingest(tenantId, meeting.id, [r({ text: '初期費用が' })]);
    const translator = new EchoTranslationProvider();
    const translate = vi.spyOn(translator, 'translate');
    const create = () => new MeetingService({ db, publisher: { async publish() {} }, translator });
    const answers = await Promise.all(
      [create(), create(), create()].map((s) =>
        s.translate(tenantId, meeting.id, segment!, 'en-US'),
      ),
    );
    expect(new Set(answers).size).toBe(1);
    await create().translate(tenantId, meeting.id, segment!, 'en-US');
    expect(translate).toHaveBeenCalledTimes(1);
    const rows = await withTenant(db, tenantId, (tx) =>
      tx.selectFrom('translations').selectAll().where('meeting_id', '=', meeting.id).execute(),
    );
    expect(rows).toHaveLength(1);
    const events = await service.eventsAfter(tenantId, meeting.id, 0);
    expect(events.filter((e) => e.type === 'meeting.translation.final')).toHaveLength(1);
    await expect(
      create().translate(otherTenantId, meeting.id, segment!, 'en-US'),
    ).rejects.toThrow();
    expect(translate).toHaveBeenCalledTimes(1);
    expect(await create().translate(tenantId, meeting.id, segment!, 'ja')).toBe(segment!.text);
    expect(translate).toHaveBeenCalledTimes(1); // already in target language
  });

  it('marks a meeting degraded without ending it', async () => {
    // STT が落ちても録音は続く（AC3-11）
    const meeting = await startMeeting();
    await service.markDegraded(tenantId, meeting.id);
    const after = await service.get(tenantId, meeting.id);
    expect(after.degraded_at).not.toBeNull();
    expect(after.status).toBe('RECORDING');
  });

  it('says another tenant’s meeting does not exist', async () => {
    const meeting = await startMeeting();
    // 403 だと「その会議はある」と教えることになる
    await expect(service.get(otherTenantId, meeting.id)).rejects.toThrow(/not found/);
  });
  describe('when finalize fails', () => {
    it('does not leave the meeting looking like it is still processing', async () => {
      /*
       * UI/UX §12.5 は「閉じても続く」と言っている。進行中のまま止まると、
       * 利用者は永久に待つことになる。録音は Library に残るので失うものはない。
       */
      const meeting = await service.start({
        tenantId,
        userId,
        title: '落ちる会議',
        language: 'ja-JP',
        targetLanguage: null,
        audioSources: ['microphone'],
      });
      await service.setStatus(tenantId, meeting.id, 'FINALIZING');

      const { meetingExecutors } = await import('../src/executor.js');
      const { MemoryRecordingStore } = await import('../src/recording.js');
      const { KeywordSummarizer } = await import('../src/summarize.js');

      const executors = meetingExecutors({
        meetings: service,
        library: { create: async () => ({ id: uuidv7() }) } as never,
        recordings: new MemoryRecordingStore(),
        batch: {
          name: 'test',
          isStandIn: true,
          async transcribe() {
            throw new Error('the batch transcriber is unreachable');
          },
        },
        summarizer: new KeywordSummarizer(),
      });

      await expect(
        executors['meeting.transcribe']!.execute(
          { taskId: uuidv7(), tenantId, userId, input: { meeting_id: meeting.id } },
          { toolId: 'meeting.transcribe', args: { meeting_id: meeting.id } },
        ),
      ).rejects.toThrow(/unreachable/);

      await executors['meeting.transcribe']!.onFailure(
        { taskId: uuidv7(), tenantId, userId, input: { meeting_id: meeting.id } },
        { toolId: 'meeting.transcribe', args: { meeting_id: meeting.id } },
      );

      const after = await service.get(tenantId, meeting.id);
      expect(after.status).toBe('FAILED');
      // 終わった時刻も残る。いつ止まったかが分からないと追えない。
      expect(after.ended_at).not.toBeNull();
    });
  });

  it('meeting.bundle hands decisions and actions to the Work Graph sink with stable ids, twice the same', async () => {
    const { meetingExecutors } = await import('../src/executor.js');
    const { MemoryRecordingStore } = await import('../src/recording.js');
    const meeting = await service.start({
      tenantId,
      userId,
      title: 'MOPITA 定例',
      language: 'ja-JP',
      targetLanguage: null,
      audioSources: ['microphone'],
    });
    await service.ingest(tenantId, meeting.id, [
      {
        isFinal: true,
        speakerTag: 1,
        text: '価格案を再提出することにしましょう',
        startMs: 1000,
        endMs: 4000,
        language: 'ja',
        confidence: 0.9,
        source: 'microphone',
      },
      {
        isFinal: true,
        speakerTag: 1,
        text: '見積を 9/9 までに送ります',
        startMs: 5000,
        endMs: 8000,
        language: 'ja',
        confidence: 0.9,
        source: 'microphone',
      },
    ] as never);
    const received: string[][] = [];
    const executors = meetingExecutors({
      meetings: service,
      library: { create: async () => ({ id: uuidv7() }) } as never,
      recordings: new MemoryRecordingStore(),
      batch: {
        name: 'test',
        isStandIn: true,
        async transcribe() {
          throw new Error('unused');
        },
      },
      summarizer: {
        name: 'fixed',
        isStandIn: true,
        async summarize(segments: readonly { id: string }[]) {
          return {
            summary: [],
            decisions: [
              {
                text: '価格案を再提出することにしましょう',
                segmentIds: [String(segments[0]?.id ?? '')],
              },
            ],
            actionItems: [
              {
                text: '見積を 9/9 までに送ります',
                segmentIds: [String(segments[1]?.id ?? '')],
                assignee: '自分',
                due: '9/9',
              },
            ],
            openQuestions: [],
          };
        },
      } as never,
      sink: {
        async publish(input) {
          // 安定 id: meeting:<id>:decision|action:<segment>。世界モデル側の関数と同じ規則（そちらは pure test で見る）。
          const ids = [
            ...input.bundle.decisions.map(
              (d) =>
                `meeting:${input.meeting.id}:decision:${String(d.citations[0]?.segment_id ?? '')}`,
            ),
            ...input.bundle.action_items.map(
              (a) =>
                `meeting:${input.meeting.id}:action:${String(a.citations[0]?.segment_id ?? '')}`,
            ),
          ];
          received.push(ids);
          return { published: ids.length };
        },
      },
    });
    const run = () =>
      executors['meeting.bundle']!.execute(
        { taskId: uuidv7(), tenantId, userId, input: { meeting_id: meeting.id } },
        { toolId: 'meeting.bundle', args: { meeting_id: meeting.id } },
      );
    const first = await run();
    const second = await run();
    expect(first.detail).toContain('to Work Graph');
    expect(received).toHaveLength(2);
    expect(received[0]).toEqual(received[1]);
    expect((first.result as { work_artifacts: number }).work_artifacts).toBe(received[0]!.length);
    expect((second.result as { work_artifacts: number }).work_artifacts).toBe(received[0]!.length);
  });
});
