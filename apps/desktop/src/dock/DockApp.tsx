/**
 * Dock window のルート。main window とは別の window で動く（§4）。
 *
 * Conversation Engine へは、この window から直接繋ぐ。
 * main window を経由させると、main が閉じている間 Dock が使えなくなる。
 */
import { useCallback, useMemo, useRef, type ReactElement } from 'react';
import { AstraClient } from '@astra/api-client';
import { ThemeProvider } from '../state/ThemeProvider.js';
import { SessionProvider, useSession } from '../state/SessionProvider.js';
import { TaskDock } from './TaskDock.js';
import type { DockConversation } from './useDockMachine.js';
import './dock.css';

function useConversation(client: AstraClient | null): DockConversation | undefined {
  // 会話は 1 本を使い回す。発話のたびに始めると、文脈が毎回消える。
  const conversationId = useRef<string | null>(null);

  const send = useCallback(
    async (text: string) => {
      if (!client) throw new Error('まだ接続していません');
      if (!conversationId.current) {
        conversationId.current = (await client.startConversation()).id;
      }
      const result = await client.sendTurn(conversationId.current, {
        text,
        modality: 'text',
        // 新しい入力が来たら、走っている応答を打ち切る（正本 §7.2）
        interrupt: true,
      });
      return { needsClarification: result.needsClarification, answer: result.answer };
    },
    [client],
  );

  return useMemo(() => (client ? { send } : undefined), [client, send]);
}

function DockSurface(): ReactElement {
  const { client, status } = useSession();
  const conversation = useConversation(status === 'signed-in' ? client : null);
  return <TaskDock {...(conversation ? { conversation } : {})} />;
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
