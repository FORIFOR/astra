/**
 * Dock window のルート。main window とは別の window で動く（§4）。
 *
 * Conversation Engine へは、この window から直接繋ぐ。
 * main window を経由させると、main が閉じている間 Dock が使えなくなる。
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MutableRefObject,
  type ReactElement,
} from 'react';
import { AstraClient } from '@astra/api-client';
import { ThemeProvider } from '../state/ThemeProvider.js';
import { SessionProvider, useSession } from '../state/SessionProvider.js';
import { TaskDock } from './TaskDock.js';
import type { ContextReferent, DockConversation } from './useDockMachine.js';
import type { ApprovalId } from '@astra/contracts';
import { useTaskStream } from '../work/useTaskStream.js';
import { workspace } from '../host/tauri.js';
import './dock.css';

function useConversation(
  client: AstraClient | null,
  // 会話は 1 本を使い回す。発話のたびに始めると、文脈が毎回消える。
  conversationId: MutableRefObject<string | null>,
): DockConversation | undefined {
  const send = useCallback(
    async (text: string, referents: readonly ContextReferent[]) => {
      if (!client) throw new Error('まだ接続していません');
      if (!conversationId.current) {
        conversationId.current = (await client.startConversation()).id;
      }
      const result = await client.sendTurn(conversationId.current, {
        text,
        modality: 'text',
        // 新しい入力が来たら、走っている応答を打ち切る（正本 §7.2）
        interrupt: true,
        /*
         * 画面に出ているものを一緒に渡す（正本 §6）。
         * **これを渡さないと、一言目の「この会社」で必ず聞き返す。**
         * Context Lens に出しておきながら送らないのは、出していないのと同じ。
         */
        context_referents: referents.map((r) => ({ label: r.label, kind: r.kind })),
      });
      return { needsClarification: result.needsClarification, answer: result.answer };
    },
    [client],
  );

  return useMemo(() => (client ? { send } : undefined), [client, send]);
}

/**
 * 頼んだあと、どの仕事が始まったかを見つける。
 *
 * 会話の応答は仕事の id を返さない（何をする話かは lane として現れる）。
 * だが仕事は `conversation_id` を持って作られるので、
 * **この会話から生まれた最新の仕事**を探せば辿り着ける。
 * 見つかるまで少し待つ。永久には待たない。
 */
function useStartedTask(
  client: AstraClient | null,
  conversationId: () => string | null,
): { taskId: string | null; awaitTask(): void } {
  const [taskId, setTaskId] = useState<string | null>(null);
  const [waiting, setWaiting] = useState(false);

  useEffect(() => {
    if (!waiting || !client) return;
    let cancelled = false;
    let tries = 0;
    const look = async (): Promise<void> => {
      const id = conversationId();
      if (!id) return;
      const page = await client.listTasks({ limit: 20 }).catch(() => null);
      const mine = page?.items.find((t) => t.conversation_id === id);
      if (cancelled) return;
      if (mine) {
        setTaskId(mine.id);
        setWaiting(false);
        return;
      }
      // 10 秒ほど見て、無ければ諦める（見つからなかったことは status に出る）
      if ((tries += 1) < 12) setTimeout(() => void look(), 800);
      else setWaiting(false);
    };
    void look();
    return () => {
      cancelled = true;
    };
  }, [waiting, client, conversationId]);

  return { taskId, awaitTask: () => setWaiting(true) };
}

function DockSurface(): ReactElement {
  const { client, status } = useSession();
  const live = status === 'signed-in' ? client : null;
  const conversationRef = useRef<string | null>(null);
  const conversation = useConversation(live, conversationRef);
  const started = useStartedTask(live, () => conversationRef.current);
  const { view } = useTaskStream(live, started.taskId);

  // 頼めた（聞き返しでなかった）ら、始まった仕事を探しに行く
  const watched = useMemo<DockConversation | undefined>(
    () =>
      conversation
        ? {
            async send(text, referents) {
              const result = await conversation.send(text, referents);
              if (!result.needsClarification) started.awaitTask();
              return result;
            },
          }
        : undefined,
    [conversation, started],
  );

  const taskId = started.taskId;
  const work = taskId && view.status !== 'UNKNOWN' ? view : null;

  return (
    <TaskDock
      {...(watched ? { conversation: watched } : {})}
      {...(work ? { work } : {})}
      {...(live && taskId
        ? {
            // §14.1: 承認は Dock の中で。full app へ遷移しない
            onApprove: (approvalId: string) =>
              void live.decideApproval(taskId, {
                approval_id: approvalId as ApprovalId,
                decision: 'APPROVED',
              }),
            onReject: (approvalId: string) =>
              void live.decideApproval(taskId, {
                approval_id: approvalId as ApprovalId,
                decision: 'REJECTED',
              }),
            // §4.4: Dismiss と Cancel を分ける。これは Cancel
            onStop: () => void live.cancelTask(taskId),
            // §2.2: 深く扱う必要がある時だけ本体を開く
            onOpenWorkspace: () => void workspace.open(taskId),
          }
        : {})}
    />
  );
}

export function DockApp(): ReactElement {
  return (
    <ThemeProvider>
      <SessionProvider>
        <DockSurface />
      </SessionProvider>
    </ThemeProvider>
  );
}
