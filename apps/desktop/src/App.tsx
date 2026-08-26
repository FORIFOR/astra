import type { ReactElement } from 'react';
import { ShellProvider, useShell } from './state/ShellProvider.js';
import { ThemeProvider } from './state/ThemeProvider.js';
import { AppShell } from './shell/AppShell.js';
import { HomePage } from './pages/Home.js';
import { WorkPage } from './pages/Work.js';
import { LibraryPage } from './pages/Library.js';
import { AppsPage } from './pages/Apps.js';
import './shell/shell.css';

function ActivePage(): ReactElement {
  const { activeTab } = useShell();
  switch (activeTab) {
    case 'home':
      return <HomePage />;
    case 'work':
      return <WorkPage />;
    case 'library':
      return <LibraryPage />;
    case 'apps':
      return <AppsPage />;
  }
}

export function App(): ReactElement {
  return (
    <ThemeProvider>
      <ShellProvider>
        <AppShell>
          <ActivePage />
        </AppShell>
      </ShellProvider>
    </ThemeProvider>
  );
}
