/**
 * 会議の HTTP / WS 表面。Phase 3 実装仕様 §6。AC3-1 〜 AC3-5、AC3-11、AC3-12。
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { uuidv7, type Meeting, type MeetingSegment, type TokenResponse } from '@astra/contracts';
import type { ScriptLine } from '@astra/service-meeting';
import { makeTestApp, makeTokens, testDbConfig, type TestApp } from './support.js';
import type { App } from '../src/fastify.js';

const url = process.env['TEST_DATABASE_URL'];
const identityUrl = process.env['TEST_IDENTITY_DATABASE_URL'];

const SCRIPT: ScriptLine[] = [
  { speakerTag: 1, text: '初期費用が気になっています', startMs: 0, endMs: 3_000 },
  { speakerTag: 2, text: '分割については対応します', startMs: 3_000, endMs: 6_000 },
];

describe.skipIf(!url)('meetings', () => {
  let harness: TestApp;
  let app: App;
  let auth: { authorization: string };

  const start = (payload: Record<string, unknown> = {}) =>
    app.inject({
      method: 'POST',
      url: '/v1/meetings',
      headers: auth,
      payload: { title: 'A社 新規提案', consent_confirmed: true, ...payload },
    });

  const startedMeeting = async (): Promise<Meeting> => (await start()).json<Meeting>();

  beforeAll(async () => {
    harness = await makeTestApp({
      dbConfig: testDbConfig(url!, identityUrl),
      tokens: await makeTokens(),
      script: SCRIPT,
    });
    app = harness.app;

    const issued = await app.inject({
      method: 'POST',
      url: '/v1/auth/dev/token',
      payload: { email: `mt-${uuidv7()}@example.com`, display_name: 'MT' },
    });
    auth = { authorization: `Bearer ${issued.json<TokenResponse>().access_token}` };
  });

  afterAll(async () => {
    await harness?.close();
  });

  describe('starting (AC3-1)', () => {
    it('refuses to record without a confirmed consent', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/meetings',
        headers: auth,
        payload: { title: 'こっそり録音' },
      });
      expect(res.statusCode).toBe(400);
    });

    it('records what is being captured and in which language', async () => {
      const res = await start({ audio_sources: ['microphone', 'system'], language: 'ja-JP' });
      expect(res.statusCode).toBe(201);
      const meeting = res.json<Meeting>();
      expect(meeting.status).toBe('RECORDING');
      expect(meeting.audio_sources).toEqual(['microphone', 'system']);
      expect(meeting.consent_at).not.toBeNull();
    });
  });

  describe('audio and transcript (AC3-2, AC3-3)', () => {
    it('turns audio into speaker-tagged segments, keeping only the final ones', async () => {
      const meeting = await startedMeeting();
      const stream = await harness.meetings; // service を直接使わず HTTP 経由で流したいが、
      expect(stream).toBeDefined();

      // WS は inject で扱えないので、gateway が使うのと同じ service 経路を通す。
      // WS 自体の疎通は受け入れスイートの実プロセスで確かめる。
      const { ScriptedStreamingTranscriber } = await import('@astra/service-meeting');
      const session = await new ScriptedStreamingTranscriber(SCRIPT).start({ language: 'ja-JP' });
      for (let atMs = 0; atMs <= 6_000; atMs += 1_000) {
        const frame = new Uint8Array(3_200);
        await harness.recordings.append(meeting.id, frame);
        await harness.meetings.ingest(
          meeting.tenant_id,
          meeting.id,
          await session.push(frame, atMs),
        );
      }

      const res = await app.inject({
        method: 'GET',
        url: `/v1/meetings/${meeting.id}/segments`,
        headers: auth,
      });
      expect(res.statusCode).toBe(200);
      const { items } = res.json<{ items: MeetingSegment[] }>();
      expect(items.map((s) => s.speaker_tag)).toEqual([1, 2]);
      expect(items.map((s) => s.text)).toEqual([
        '初期費用が気になっています',
        '分割については対応します',
      ]);
      // 途中経過は保存されない（D-24）
      expect(items.every((s) => s.pass === 'live')).toBe(true);
      expect(items.some((s) => s.text.includes('初期費用が気に') && s.text.length < 10)).toBe(
        false,
      );
    });

    it('streams the transcript as events and closes when the meeting ends', async () => {
      const meeting = await startedMeeting();
      const { ScriptedStreamingTranscriber } = await import('@astra/service-meeting');
      const session = await new ScriptedStreamingTranscriber(SCRIPT).start({ language: 'ja-JP' });
      await harness.meetings.ingest(
        meeting.tenant_id,
        meeting.id,
        await session.push(new Uint8Array(3_200), 3_000),
      );
      // 終端が無いと購読は永久に開いたまま。会議の終わりで閉じる。
      await harness.meetings.setStatus(meeting.tenant_id, meeting.id, 'COMPLETE');

      const res = await app.inject({
        method: 'GET',
        url: `/v1/meetings/${meeting.id}/stream`,
        headers: auth,
      });
      expect(res.statusCode).toBe(200);
      // 途中経過は流れるが保存はされない
      expect(res.body).toContain('meeting.transcript.partial');
      expect(res.body).toContain('meeting.transcript.final');
      expect(res.body).toContain('meeting.ended');
    });
  });

  describe('speakers (AC3-4)', () => {
    it('pins a name for the rest of the meeting and lets it be corrected', async () => {
      const meeting = await startedMeeting();
      const named = await app.inject({
        method: 'POST',
        url: `/v1/meetings/${meeting.id}/speakers`,
        headers: auth,
        payload: { speaker_tag: 1, display_name: '田中' },
      });
      expect(named.statusCode).toBe(200);

      await app.inject({
        method: 'POST',
        url: `/v1/meetings/${meeting.id}/speakers`,
        headers: auth,
        payload: { speaker_tag: 1, display_name: '田中 部長' },
      });

      const res = await app.inject({
        method: 'GET',
        url: `/v1/meetings/${meeting.id}/segments`,
        headers: auth,
      });
      const { speakers } = res.json<{ speakers: { display_name: string }[] }>();
      expect(speakers.map((s) => s.display_name)).toEqual(['田中 部長']);
    });
  });

  describe('finishing (AC3-6)', () => {
    it('hands the finalize off to a durable task', async () => {
      const meeting = await startedMeeting();
      const res = await app.inject({
        method: 'POST',
        url: `/v1/meetings/${meeting.id}/finish`,
        headers: auth,
      });
      expect(res.statusCode).toBe(202);
      const body = res.json<{ task_id: string }>();
      expect(body.task_id).toBeTruthy();

      const after = await app.inject({
        method: 'GET',
        url: `/v1/meetings/${meeting.id}`,
        headers: auth,
      });
      expect(after.json<Meeting>().status).toBe('FINALIZING');
    });

    it('returns the same task when the button is pressed twice', async () => {
      const meeting = await startedMeeting();
      const first = await app.inject({
        method: 'POST',
        url: `/v1/meetings/${meeting.id}/finish`,
        headers: auth,
      });
      const second = await app.inject({
        method: 'POST',
        url: `/v1/meetings/${meeting.id}/finish`,
        headers: auth,
      });
      expect(second.statusCode).toBe(202);
      expect(second.json<{ task_id: string }>().task_id).toBe(
        first.json<{ task_id: string }>().task_id,
      );
    });
  });

  describe('degraded transcription (AC3-11)', () => {
    it('keeps recording and marks the meeting instead of failing it', async () => {
      const meeting = await startedMeeting();
      await harness.recordings.append(meeting.id, new Uint8Array(3_200));
      await harness.meetings.markDegraded(meeting.tenant_id, meeting.id);

      const res = await app.inject({
        method: 'GET',
        url: `/v1/meetings/${meeting.id}`,
        headers: auth,
      });
      const after = res.json<Meeting>();
      expect(after.degraded_at).not.toBeNull();
      // 録音は続く
      expect(after.status).toBe('RECORDING');
      expect(await harness.recordings.sizeOf(meeting.id)).toBeGreaterThan(0);
    });
  });

  describe('another tenant (AC3-12)', () => {
    it('says the meeting does not exist rather than that it is forbidden', async () => {
      const meeting = await startedMeeting();
      const outsider = await app.inject({
        method: 'POST',
        url: '/v1/auth/dev/token',
        payload: { email: `out-${uuidv7()}@example.com`, display_name: 'O' },
      });
      const headers = {
        authorization: `Bearer ${outsider.json<TokenResponse>().access_token}`,
      };

      for (const url of [`/v1/meetings/${meeting.id}`, `/v1/meetings/${meeting.id}/segments`]) {
        expect((await app.inject({ method: 'GET', url, headers })).statusCode).toBe(404);
      }
      expect(
        (
          await app.inject({
            method: 'POST',
            url: `/v1/meetings/${meeting.id}/finish`,
            headers,
          })
        ).statusCode,
      ).toBe(404);
    });
  });
});
