import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react';
import { ShellProvider, useShell } from './state/ShellProvider.js';
import { ThemeProvider } from './state/ThemeProvider.js';
import { SessionProvider, useSession } from './state/SessionProvider.js';
import type { AstraClient } from '@astra/api-client';
import { workspace } from './host/tauri.js';
import { WorkspaceDataProvider, useWorkspaceData } from './state/WorkspaceData.js';
import { SignIn } from './auth/SignIn.js';
import { AppShell } from './shell/AppShell.js';
import type { ComposerConversation } from './shell/Composer.js';
import { TaskInspector } from './shell/TaskInspector.js';
import { HomePage } from './pages/Home.js';
import { useProactiveNotifications } from './home/useProactive.js';
import { WorkPage } from './pages/Work.js';
import { LibraryPage } from './pages/Library.js';
import { AppsPage } from './pages/Apps.js';
import { MeetingProvider, useMeeting } from './meeting/MeetingProvider.js';
import { Onboarding } from './onboarding/Onboarding.js';
import { MeetingLayer } from './meeting/MeetingLayer.js';
import './shell/shell.css';

/**
 * 割り込みの層。UI/UX §16。
 *
 * どのタブを見ていても、approval 待ちや録音の失敗は届かなければならない。
 * 画面の中に置くと、そのタブを開いていないときに黙る。
 */
function ProactiveLayer(): null {
  const { brief } = useWorkspaceData();
  useProactiveNotifications(brief);
  return null;
}

/**
 * Workspace から Astra へ話す口。UI/UX §7。
 *
 * Dock の `useConversation` と同じ形。**別の口にしない** —
 * 別にすると、Dock で言ったことと本体で言ったことが別の会話になり、
 * 「さっき言ったやつ」が通じなくなる。
 */
function useWorkspaceConversation(client: AstraClient | null): ComposerConversation | undefined {
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
        context_referents: [],
      });
      return { needsClarification: result.needsClarification, answer: result.answer };
    },
    [client],
  );

  return useMemo(() => (client ? { send } : undefined), [client, send]);
}

/**
 * §7.1 の Inspector に、開いている仕事の周辺を出す。
 * AppShell は ShellProvider の中に居るので、ここで focus を読める。
 */
function ShellWithInspector({
  children,
  conversation,
}: {
  children: ReactNode;
  conversation?: ComposerConversation | undefined;
}): ReactElement {
  const { focusedTaskId } = useShell();
  const { tasks } = useWorkspaceData();
  const { client } = useSession();
  const task = tasks.find((t) => t.id === focusedTaskId) ?? null;
  return (
    <AppShell
      {...(conversation ? { conversation } : {})}
      inspector={<TaskInspector client={client} task={task} />}
    >
      {children}
    </AppShell>
  );
}

/**
 * Dock からの「この仕事を開いて」。UI/UX §2.2・§4.4。
 * Tauri が居なければ何も購読しない（ブラウザには Dock が無い）。
 */
function OpenTaskListener(): null {
  const { openTask, goToTab } = useShell();
  useEffect(() => {
    let dispose: (() => void) | null = null;
    void workspace
      .onOpenTask((taskId) => {
        if (taskId) openTask(taskId);
        else goToTab('work');
      })
      .then((off) => {
        dispose = off;
      });
    return () => dispose?.();
  }, [openTask, goToTab]);
  return null;
}

function ActivePage({
  conversation,
}: {
  conversation?: ComposerConversation | undefined;
}): ReactElement {
  const { activeTab, focusedTaskId, focusedArtifactId, openTask, openArtifact, goToTab } =
    useShell();
  const { tasks, artifacts, brief, reload } = useWorkspaceData();
  const { client, me } = useSession();
  const { requestStart: requestStartMeeting } = useMeeting();
  const [homeNotice, setHomeNotice] = useState<string | null>(null);

  /*
   * Home の「何を終わらせますか？」。§8 の universal entry。
   * 聞き返しが返ったら **進めずに** その言葉を出す（正本 §7.2）。
   * 頼めたら Work へ移る。頼んだものはそこに現れる。
   */
  const askFromHome = useCallback(
    async (text: string) => {
      if (!conversation) {
        setHomeNotice('まだ接続していません。サインインし直してください。');
        return;
      }
      try {
        const result = await conversation.send(text);
        if (result.needsClarification) {
          setHomeNotice(result.answer);
          return;
        }
        setHomeNotice(null);
        await reload();
        goToTab('work');
      } catch (cause) {
        setHomeNotice(cause instanceof Error ? cause.message : '送れませんでした');
      }
    },
    [conversation, goToTab, reload],
  );

  switch (activeTab) {
    case 'home':
      return (
        <HomePage
          tasks={tasks}
          artifacts={artifacts}
          brief={brief}
          displayName={me?.user.display_name ?? null}
          onOpenTask={openTask}
          onOpenArtifact={openArtifact}
          // §8.1「4件目以降は『すべて見る』」。繋がっていない button が残っていた。
          onShowAll={() => goToTab('work')}
          onAsk={(text) => void askFromHome(text)}
          notice={homeNotice}
          onDismiss={(itemId, verdict) => {
            // 覚えられなかったことを黙らない（次にまた出てくるため）
            void client?.dismissAttention(itemId, verdict).catch((error: unknown) => {
              console.warn('could not remember the dismissal', error);
            });
          }}
        />
      );
    case 'work':
      return (
        <WorkPage
          client={client}
          tasks={tasks}
          initialTaskId={focusedTaskId}
          onStartMeeting={requestStartMeeting}
          onOpenArtifact={openArtifact}
        />
      );
    case 'library':
      return (
        <LibraryPage
          client={client}
          artifacts={artifacts}
          tasks={tasks}
          selectedId={focusedArtifactId}
          onSelect={openArtifact}
          onOpenTask={openTask}
        />
      );
    case 'apps':
      return <AppsPage client={client} />;
  }
}

/** 会議の層。タブを跨いで見えている必要があるので shell の外に置く。 */
function MeetingSurfaceLayer(): ReactElement | null {
  const { openTask } = useShell();
  return <MeetingLayer onOpenWork={openTask} />;
}

function Workspace(): ReactElement {
  const { status, client } = useSession();
  // 初回だけ。**終わったかどうかは server が持つ**（端末を変えても続きから）。
  const [onboarded, setOnboarded] = useState<boolean | null>(null);

  useEffect(() => {
    if (status !== 'signed-in' || !client) return;
    let cancelled = false;
    void client
      .onboarding()
      .then((state) => {
        if (!cancelled) setOnboarded(state.completed_at !== null);
      })
      // 取れなければ邪魔をしない。セットアップで製品を止めない。
      .catch(() => setOnboarded(true));
    return () => {
      cancelled = true;
    };
  }, [status, client]);

  /*
   * 下端の composer が話す先。**会話は 1 本を使い回す。**
   * 発話のたびに始めると、文脈が毎回消える（Dock と同じ理屈）。
   */
  const conversation = useWorkspaceConversation(client);

  if (status === 'loading') {
    return (
      <main className="astra-signin">
        <p role="status">読み込んでいます…</p>
      </main>
    );
  }
  if (status === 'signed-out') return <SignIn />;
  if (onboarded === false) {
    return <Onboarding client={client} onDone={() => setOnboarded(true)} />;
  }

  return (
    <WorkspaceDataProvider client={client}>
      <ShellProvider>
        <MeetingProvider client={client}>
          <ShellWithInspector {...(conversation ? { conversation } : {})}>
            <ActivePage {...(conversation ? { conversation } : {})} />
          </ShellWithInspector>
          {/* Dock の「詳しく見る」を受ける。本体が前に出て、その仕事へ移る。 */}
          <OpenTaskListener />
          {/* 会議はタブではなく状態。4 タブは増やさない（正本 §2）。 */}
          <MeetingSurfaceLayer />
          {/* §16: どのタブを見ていても、確認待ちと失敗は届く。 */}
          <ProactiveLayer />
        </MeetingProvider>
      </ShellProvider>
    </WorkspaceDataProvider>
  );
}

export function App(): ReactElement {
  return (
    <ThemeProvider>
      <SessionProvider>
        <Workspace />
      </SessionProvider>
    </ThemeProvider>
  );
}
