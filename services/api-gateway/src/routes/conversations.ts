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
import type { TaskService } from '@astra/service-task';
import type { App } from '../fastify.js';
import { requirePrincipal } from '../auth/middleware.js';

export interface ConversationRouteDeps {
  readonly conversations: ConversationService;
  readonly tasks: TaskService;
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

      // Lane は返さない。利用者に見せないものを API で配らない。
      return reply.status(202).send({
        turn,
        needs_clarification: false,
        // 何をする話かは、次に作られる task の kind として現れる
        intent: laneToIntent(decision.lane),
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
