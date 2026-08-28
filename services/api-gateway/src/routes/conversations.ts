/**
 * Conversation の HTTP 表面。正本 §7・§19、Phase 7 実装仕様 §3。
 *
 * ここが Task Dock の入口になる。**Lane は返さない。**
 * 利用者に見せないものを API で配ると、いずれ画面に出る。
 */
import { SendTurnRequest, StartConversationRequest, type Referent } from '@astra/contracts';
import type { ConversationService } from '@astra/service-conversation';
import {
  clarificationFor,
  remember,
  resolveReferences,
  routeLane,
} from '@astra/service-conversation';
import { agentKindFor, type TaskService } from '@astra/service-task';
import type { Redis } from 'ioredis';
import type { App } from '../fastify.js';
import { parseLastEventId, pollingWaker, pumpEventStream, redisWaker } from './sse.js';
import { requirePrincipal } from '../auth/middleware.js';

export interface ConversationRouteDeps {
  readonly conversations: ConversationService;
  readonly tasks: TaskService;
  readonly redis: Redis | null;
  readonly ssePollIntervalMs?: number;
}

export function registerConversationRoutes(app: App, deps: ConversationRouteDeps): void {
  app.post('/v1/conversations', async (request, reply) => {
    const principal = requirePrincipal();
    const body = StartConversationRequest.parse(request.body ?? {});
    const started = await deps.conversations.start(principal.tenantId, principal.userId, {
      ...(body.title === undefined ? {} : { title: body.title }),
      responseMode: body.response_mode,
    });
    return reply.status(201).send({ id: started.id, state: started.state });
  });

  app.get<{ Params: { conversationId: string } }>(
    '/v1/conversations/:conversationId',
    async (request) => {
      const principal = requirePrincipal();
      const id = request.params.conversationId;
      const [state, turns, summaries] = await Promise.all([
        deps.conversations.state(principal.tenantId, id),
        deps.conversations.recentTurns(principal.tenantId, id),
        deps.conversations.summaries(principal.tenantId, id),
      ]);
      return { id, state, turns, summaries };
    },
  );

  /**
   * SSE。正本 §19 `GET /v1/conversations/{id}/stream`、§20 の統一 envelope（sequence 付き）を流す。
   * Last-Event-ID で再開できる（取りこぼしを検知できるよう sequence は詰めない）。
   */
  app.get<{ Params: { conversationId: string } }>(
    '/v1/conversations/:conversationId/stream',
    { config: { rateLimit: false } },
    async (request, reply) => {
      const principal = requirePrincipal();
      const conversationId = request.params.conversationId;
      // 存在しない / 他テナントならストリームを開く前に 404
      await deps.conversations.state(principal.tenantId, conversationId);

      // 購読はリプレイの前に張る（実装仕様 §7.3）
      const waker = deps.redis
        ? await redisWaker(deps.redis, 'conversation', conversationId)
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
            deps.conversations.eventsAfter(principal.tenantId, conversationId, sequence),
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

  /**
   * 発話を受ける。
   *
   * ここで決まるのは「何をする話か（Lane）」と「指示語が解けたか」だけ。
   * **解けなかったら聞き返す**。埋めて進めない（D-49）。
   */
  app.post<{ Params: { conversationId: string } }>(
    '/v1/conversations/:conversationId/turns',
    async (request, reply) => {
      const principal = requirePrincipal();
      const id = request.params.conversationId;
      const body = SendTurnRequest.parse(request.body ?? {});

      const state = await deps.conversations.state(principal.tenantId, id);

      // barge-in。新しい入力が来たら、走っている応答を打ち切る（正本 §7.2）
      if (body.interrupt) {
        await deps.conversations.interruptLastAssistantTurn(principal.tenantId, id);
      }

      const turn = await deps.conversations.append({
        tenantId: principal.tenantId,
        conversationId: id,
        role: 'user',
        modality: body.modality,
        text: body.text,
      });

      const resolutions = resolveReferences(body.text, {
        referents: state.referents as Referent[],
        // いま見ているもの。会話に出ていなくても「この◯◯」は解ける（正本 §6）
        contextLabels: body.context_referents.map((r) => r.label),
      });
      const clarification = clarificationFor(resolutions);

      const decision = routeLane({
        text: body.text,
        modality: body.modality,
        meetingActive: state.active_meeting !== null,
        hasSelection: false,
        namedAgent: null,
      });

      /*
       * 指示語が解けないまま先へ進めない。
       * 進めると、利用者が指したものとは別のものに対して動く。
       */
      if (clarification) {
        const answer = await deps.conversations.append({
          tenantId: principal.tenantId,
          conversationId: id,
          role: 'assistant',
          modality: state.response_mode,
          text: clarification,
        });
        return reply.status(200).send({ turn, answer, needs_clarification: true });
      }

      /*
       * ここで**仕事を始める。**
       *
       * 長らく lane を決めて `intent` を返すだけで、**何も始めていなかった。**
       * Home で頼んでも、Composer で頼んでも、Dock で頼んでも、
       * 会話に行が増えるだけで仕事は現れず、Dock は 10 秒待って諦めていた。
       */
      const started = await startWork(deps, principal, id, body.text, decision.lane, turn.id);

      // Lane は返さない。利用者に見せないものを API で配らない。
      return reply.status(202).send({
        turn,
        needs_clarification: false,
        // 何をする話かは、次に作られる task の kind として現れる
        intent: laneToIntent(decision.lane),
        task_id: started.taskId,
        // 始められなかった理由。**黙って intent だけ返さない。**
        notice: started.notice,
      });
    },
  );

  /** 触れたものを覚える。「それ」の解決先になる。 */
  app.post<{ Params: { conversationId: string } }>(
    '/v1/conversations/:conversationId/referents',
    async (request, reply) => {
      const principal = requirePrincipal();
      const id = request.params.conversationId;
      const state = await deps.conversations.state(principal.tenantId, id);
      const next = request.body as Omit<Referent, 'index'>;

      await deps.conversations.rememberReferent(
        principal.tenantId,
        id,
        remember(state.referents as Referent[], next),
      );
      return reply.status(204).send();
    },
  );
}

/**
 * Lane を、利用者にも見せてよい言葉へ直す。
 * 内部名（`specialist-agent` など）をそのまま出さない。
 */
function laneToIntent(lane: string): string {
  switch (lane) {
    case 'research':
      return 'looking_up';
    case 'action':
      return 'doing';
    case 'edit':
      return 'editing';
    case 'meeting':
      return 'meeting';
    case 'dictate':
      return 'writing_down';
    case 'specialist-agent':
      return 'delegating';
    default:
      return 'talking';
  }
}

/**
 * Lane に応じて仕事を作る。
 *
 *   chat     → General Assistant（正本 §2.2）。答えは成果物として残る
 *   research → Research Agent（§8）
 *   meeting  → 仕事にしない。録音は画面側の操作（§12）
 *   action / edit / dictate / specialist-agent → まだ自動では受けられない。**そう言う**
 *
 * 作れなかった理由（plugin が入っていない等）は `notice` で返す。
 * 例外で 500 にすると、利用者には「送れなかった」としか見えない。
 */
async function startWork(
  deps: ConversationRouteDeps,
  principal: { tenantId: string; userId: string },
  conversationId: string,
  text: string,
  lane: string,
  turnId: string,
): Promise<{ taskId: string | null; notice: string | null }> {
  const request =
    lane === 'chat'
      ? {
          kind: agentKindFor('com.astra.general', 'assistant'),
          input: { question: text, message: text },
        }
      : lane === 'research'
        ? { kind: 'research', input: { question: text } }
        : null;

  if (!request) {
    return {
      taskId: null,
      notice: lane === 'meeting' ? null : 'この頼みごとは、まだ自動では進められません。',
    };
  }

  try {
    const { task } = await deps.tasks.create({
      tenantId: principal.tenantId,
      userId: principal.userId,
      request: { ...request, conversation_id: conversationId as never },
      // 同じ発話を二度仕事にしない
      idempotencyKey: `turn:${turnId}`,
    });
    return { taskId: task.id, notice: null };
  } catch (error) {
    return {
      taskId: null,
      notice:
        error instanceof Error && /install|not installed|permission|scope/i.test(error.message)
          ? 'General Assistant が追加されていません。Apps から追加してください。'
          : '仕事を始められませんでした。',
    };
  }
}
