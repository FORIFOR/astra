/**
 * 会議の HTTP / WS 表面。Phase 3 実装仕様 §6。
 *
 * ここは変換だけを行う。業務判断は MeetingService 側にある（ADR 0004）。
 *
 * 音声だけ WS で受けるのは、100ms ごとのフレームを HTTP 要求にすると
 * 会議 1 時間で 36,000 要求になるため。制御（pause / marker）は同じ WS の
 * text フレームに乗せ、経路を 2 本に分けない。
 */
import type { Redis } from 'ioredis';
import {
  AstraError,
  CreateMeetingRequest,
  MeetingControlMessage,
  NameSpeakerRequest,
  TranscriptPass,
  type AccessTokenClaims,
} from '@astra/contracts';
import type { Logger } from '@astra/telemetry';
import type {
  MeetingService,
  RecordingStore,
  StreamingSession,
  StreamingTranscriber,
} from '@astra/service-meeting';
import type { TaskService } from '@astra/service-task';
import type { App } from '../fastify.js';
import { requirePrincipal } from '../auth/middleware.js';
import { bearerToken, type TokenVerifier } from '../auth/tokens.js';
import { parseLastEventId, pollingWaker, pumpEventStream, redisWaker } from './sse.js';

/** 会議に要る部品一式。gateway が組み立てて渡す（ADR 0001）。 */
export interface MeetingRuntime {
  readonly meetings: MeetingService;
  readonly recordings: RecordingStore;
  /** live の文字起こし。未設定なら録音だけ行う（STT が未接続の環境）。 */
  readonly transcriber?: StreamingTranscriber;
}

export interface MeetingRouteDeps extends MeetingRuntime {
  readonly tasks: TaskService;
  readonly tokens: TokenVerifier;
  readonly logger: Logger;
  readonly redis: Redis | null;
  readonly ssePollIntervalMs?: number;
}

declare module 'fastify' {
  interface FastifyRequest {
    /** preValidation が確定させた会議用のクレーム。 */
    meetingClaims?: AccessTokenClaims;
  }
}

export function registerMeetingRoutes(app: App, deps: MeetingRouteDeps): void {
  app.post('/v1/meetings', async (request, reply) => {
    const principal = requirePrincipal();
    // consent_confirmed: true が無いと契約側で落ちる。同意なしの録音を始めない。
    const body = CreateMeetingRequest.parse(request.body ?? {});

    const meeting = await deps.meetings.start({
      tenantId: principal.tenantId,
      userId: principal.userId,
      title: body.title,
      language: body.language,
      targetLanguage: body.target_language,
      audioSources: body.audio_sources,
    });
    return reply.status(201).send(meeting);
  });

  app.get('/v1/meetings', async () => {
    const principal = requirePrincipal();
    return { items: await deps.meetings.list(principal.tenantId) };
  });

  app.get<{ Params: { meetingId: string } }>('/v1/meetings/:meetingId', async (request) => {
    const principal = requirePrincipal();
    return deps.meetings.get(principal.tenantId, request.params.meetingId);
  });

  app.get<{ Params: { meetingId: string }; Querystring: { pass?: string } }>(
    '/v1/meetings/:meetingId/segments',
    async (request) => {
      const principal = requirePrincipal();
      // 存在しない / 他テナントなら 404
      await deps.meetings.get(principal.tenantId, request.params.meetingId);

      const parsed = TranscriptPass.safeParse(request.query.pass);
      const segments = await deps.meetings.segments(
        principal.tenantId,
        request.params.meetingId,
        parsed.success ? parsed.data : undefined,
      );
      const speakers = await deps.meetings.speakers(principal.tenantId, request.params.meetingId);
      return { items: segments, speakers };
    },
  );

  app.post<{ Params: { meetingId: string } }>(
    '/v1/meetings/:meetingId/speakers',
    async (request) => {
      const principal = requirePrincipal();
      await deps.meetings.get(principal.tenantId, request.params.meetingId);
      const body = NameSpeakerRequest.parse(request.body ?? {});
      return deps.meetings.nameSpeaker(
        principal.tenantId,
        request.params.meetingId,
        principal.userId,
        body.speaker_tag,
        body.display_name,
      );
    },
  );

  /**
   * 終了 → finalize。**durable task にする**ので、画面を閉じても続く（D-28）。
   */
  app.post<{ Params: { meetingId: string } }>(
    '/v1/meetings/:meetingId/finish',
    async (request, reply) => {
      const principal = requirePrincipal();
      const meeting = await deps.meetings.get(principal.tenantId, request.params.meetingId);
      if (meeting.finalize_task_id) {
        // 二重に押されただけ。同じタスクを返す。
        return reply.status(202).send({
          meeting_id: meeting.id,
          task_id: meeting.finalize_task_id,
        });
      }
      if (meeting.status === 'COMPLETE' || meeting.status === 'FAILED') {
        throw new AstraError('meeting.not_recording', 'this meeting is already over');
      }

      const { task } = await deps.tasks.create({
        tenantId: principal.tenantId,
        userId: principal.userId,
        request: {
          kind: 'meeting.finalize',
          input: { meeting_id: meeting.id, title: meeting.title },
        },
        idempotencyKey: `meeting-finalize-${meeting.id}`,
      });
      await deps.meetings.setStatus(principal.tenantId, meeting.id, 'FINALIZING');
      await deps.meetings.recordBundle(principal.tenantId, meeting.id, {
        finalizeTaskId: task.id,
      });
      return reply.status(202).send({ meeting_id: meeting.id, task_id: task.id });
    },
  );

  app.get<{ Params: { meetingId: string } }>(
    '/v1/meetings/:meetingId/stream',
    { config: { rateLimit: false } },
    async (request, reply) => {
      const principal = requirePrincipal();
      const meetingId = request.params.meetingId;
      await deps.meetings.get(principal.tenantId, meetingId);

      // 購読はリプレイの前に張る（実装仕様 §7.3）
      const waker = deps.redis
        ? await redisWaker(deps.redis, 'meeting', meetingId)
        : pollingWaker();

      reply.raw.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache, no-transform',
        connection: 'keep-alive',
        'x-accel-buffering': 'no',
      });
      reply.hijack();

      let open = true;
      const close = (): void => {
        open = false;
      };
      request.raw.on('close', close);
      request.raw.on('error', close);

      try {
        await pumpEventStream({
          write: (chunk) => {
            if (open) reply.raw.write(chunk);
          },
          isOpen: () => open && !reply.raw.destroyed,
          fetchAfter: (sequence) =>
            deps.meetings.eventsAfter(principal.tenantId, meetingId, sequence),
          waker,
          startAfter: parseLastEventId(request.headers['last-event-id']),
          ...(deps.ssePollIntervalMs === undefined
            ? {}
            : { pollIntervalMs: deps.ssePollIntervalMs }),
        });
      } finally {
        await waker.close();
        if (!reply.raw.destroyed) reply.raw.end();
      }
    },
  );
}

/** 16kHz / 16bit モノラルとして、フレームの長さを ms に直す。 */
function frameDurationMs(frame: Uint8Array): number {
  return Math.round((frame.byteLength / 2 / 16_000) * 1000);
}

/** 音声 WS の 1 件。binary は音声、text(JSON) は制御。 */
interface AudioItem {
  readonly frame: Uint8Array;
  readonly control: string | null;
}

/** 会議の存在確認が終わったあとの状態。 */
interface AudioState {
  readonly session: StreamingSession | null;
  atMs: number;
  paused: boolean;
  sttDown: boolean;
}

/**
 * 音声だけ別の関数にしてある。WebSocket のルートは
 * `app.register(websocket)` が済んだスコープでしか登録できない（app.ts の注記）。
 */
export function registerMeetingAudioRoute(app: App, deps: MeetingRouteDeps): void {
  app.get<{ Params: { meetingId: string } }>(
    '/v1/meetings/:meetingId/audio',
    {
      websocket: true,
      config: { auth: false, rateLimit: false },
      /** 認証は upgrade の前に。受け入れてから閉じると原因が分からない。 */
      preValidation: async (request, reply) => {
        const token = bearerToken(request.headers.authorization);
        if (!token) {
          return reply.status(401).send({
            error: {
              code: 'auth.missing_token',
              message: 'access token required to send meeting audio',
              request_id: request.id,
            },
          });
        }
        try {
          request.meetingClaims = await deps.tokens.verifyAccessToken(token);
        } catch {
          return reply.status(401).send({
            error: {
              code: 'auth.invalid_token',
              message: 'access token is not valid',
              request_id: request.id,
            },
          });
        }
        return undefined;
      },
    },
    (connection, request) => {
      const socket = connection as unknown as {
        close(code?: number, reason?: string): void;
        on(event: string, listener: (...args: unknown[]) => void): void;
      };
      const claims = request.meetingClaims;
      if (!claims) {
        socket.close(4401, 'access token required');
        return;
      }
      const meetingId = request.params.meetingId;
      const tenantId = claims.tid;

      /**
       * **listener は同期で張る。**会議の存在確認は DB 往復なので、その間に
       * 届いたフレームは listener が無ければ捨てられる。実プロセスで音が
       * 1 バイトも残らず、これで気付いた。
       */
      const pending: AudioItem[] = [];
      let ready: AudioState | null = null;
      let closed = false;
      // 到着順を守る。並行に走らせると録音の中身が入れ替わる。
      let queue: Promise<void> = Promise.resolve();

      const handle = async (state: AudioState, item: AudioItem): Promise<void> => {
        if (item.control !== null) {
          const parsed = MeetingControlMessage.safeParse(JSON.parse(item.control));
          if (!parsed.success) return;
          if (parsed.data.type === 'pause') state.paused = true;
          if (parsed.data.type === 'resume') state.paused = false;
          return;
        }
        if (state.paused) return;

        // **録音を先に残す。**STT が落ちても音は残り、final パスで拾い直せる。
        await deps.recordings.append(meetingId, item.frame);
        state.atMs += frameDurationMs(item.frame);
        if (state.sttDown || !state.session) return;

        try {
          const results = await state.session.push(item.frame, state.atMs);
          await deps.meetings.ingest(tenantId, meetingId, results);
        } catch (error) {
          // 会議は止めない。録音は続く（AC3-11）。
          state.sttDown = true;
          await deps.meetings.markDegraded(tenantId, meetingId);
          deps.logger.warn(
            { meeting_id: meetingId, err: String(error) },
            'live transcription degraded; recording continues',
          );
        }
      };

      const enqueue = (item: AudioItem): void => {
        const state = ready;
        if (!state) {
          pending.push(item);
          return;
        }
        queue = queue.then(() => handle(state, item)).catch(() => undefined);
      };

      socket.on('message', (...args: unknown[]) => {
        const raw = args[0];
        const isBinary = args[1] as boolean | undefined;
        if (isBinary === false || typeof raw === 'string') {
          enqueue({ frame: EMPTY_FRAME, control: String(raw) });
          return;
        }
        enqueue({ frame: raw as Uint8Array, control: null });
      });

      socket.on('close', () => {
        closed = true;
        queue = queue
          .then(async () => {
            const state = ready;
            if (!state?.session || state.sttDown) return;
            await deps.meetings.ingest(tenantId, meetingId, await state.session.finish());
          })
          .catch(() => deps.meetings.markDegraded(tenantId, meetingId));
      });

      void deps.meetings
        .get(tenantId, meetingId)
        .then(async (meeting) => {
          if (closed && pending.length === 0) return;
          ready = {
            session: deps.transcriber
              ? await deps.transcriber.start({ language: meeting.language })
              : null,
            atMs: 0,
            paused: false,
            sttDown: deps.transcriber === undefined,
          };
          // 確認中に届いた分を、順番どおりに流し込む
          for (const item of pending.splice(0, pending.length)) enqueue(item);
        })
        .catch(() => {
          // 別テナントの会議に音を送り込ませない
          socket.close(4404, 'meeting not found');
        });
    },
  );
}

const EMPTY_FRAME = new Uint8Array(0);
