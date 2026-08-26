import type { ReactElement } from 'react';
import { ShellProvider, useShell } from './state/ShellProvider.js';
import { ThemeProvider } from './state/ThemeProvider.js';
import { SessionProvider, useSession } from './state/SessionProvider.js';
import { WorkspaceDataProvider, useWorkspaceData } from './state/WorkspaceData.js';
import { SignIn } from './auth/SignIn.js';
import { AppShell } from './shell/AppShell.js';
import { HomePage } from './pages/Home.js';
import { WorkPage } from './pages/Work.js';
import { LibraryPage } from './pages/Library.js';
import { AppsPage } from './pages/Apps.js';
import { MeetingProvider, useMeeting } from './meeting/MeetingProvider.js';
import { MeetingLayer } from './meeting/MeetingLayer.js';
import './shell/shell.css';

function ActivePage(): ReactElement {
  const { activeTab, focusedTaskId, focusedArtifactId, openTask, openArtifact } = useShell();
  const { tasks, artifacts } = useWorkspaceData();
  const { client, me } = useSession();
  const { requestStart: requestStartMeeting } = useMeeting();

  switch (activeTab) {
    case 'home':
      return (
        <HomePage
          tasks={tasks}
          artifacts={artifacts}
          displayName={me?.user.display_name ?? null}
          onOpenTask={openTask}
          onOpenArtifact={openArtifact}
        />
      );
    case 'work':
      return (
        <WorkPage
          client={client}
          tasks={tasks}
          initialTaskId={focusedTaskId}
          onStartMeeting={requestStartMeeting}
        />
      );
    case 'library':
      return (
        <LibraryPage
          artifacts={artifacts}
          selectedId={focusedArtifactId}
          onSelect={openArtifact}
          onOpenTask={openTask}
        />
      );
    case 'apps':
      return <AppsPage />;
  }
}

/** 会議の層。タブを跨いで見えている必要があるので shell の外に置く。 */
function MeetingSurfaceLayer(): ReactElement | null {
  const { openTask } = useShell();
  return <MeetingLayer onOpenWork={openTask} />;
}

function Workspace(): ReactElement {
  const { status, client } = useSession();

  if (status === 'loading') {
    return (
      <main className="astra-signin">
        <p role="status">読み込んでいます…</p>
      </main>
    );
  }
  if (status === 'signed-out') return <SignIn />;

  return (
    <WorkspaceDataProvider client={client}>
      <ShellProvider>
        <MeetingProvider client={client}>
          <AppShell>
            <ActivePage />
          </AppShell>
          {/* 会議はタブではなく状態。4 タブは増やさない（正本 §2）。 */}
          <MeetingSurfaceLayer />
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
