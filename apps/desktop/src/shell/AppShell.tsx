/**
 * Workspace shell。UI/UX §7.1。
 *
 * 3 カラム（sidebar / main / inspector）+ top bar。
 * 幅による振る舞いの判定は ui-kit の `resolveLayout` に閉じ込めてある。
 */
import type { ReactNode, ReactElement } from 'react';
import { useShell } from '../state/ShellProvider.js';
import { Sidebar } from './Sidebar.js';
import { TopBar } from './TopBar.js';
import { Inspector } from './Inspector.js';

export function AppShell({ children }: { children: ReactNode }): ReactElement {
  const { layout } = useShell();

  if (layout.mode === 'unsupported') {
    // §7.2: desktop MVP の最低幅は 720px。無理に潰さず、必要な幅を伝える。
    return (
      <div className="astra-too-narrow" role="alert">
        <p>Astra のデスクトップ画面には幅 720px 以上が必要です。</p>
        <p>ウィンドウを広げてください。</p>
      </div>
    );
  }

  return (
    <div
      className="astra-shell"
      data-layout={layout.mode}
      style={{ ['--astra-sidebar-width' as string]: `${layout.sidebarWidth}px` }}
    >
      <Sidebar />
      <div className="astra-shell__column">
        <TopBar />
        <main className="astra-main" tabIndex={-1}>
          {children}
        </main>
      </div>
      <Inspector />
    </div>
  );
}
