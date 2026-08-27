/**
 * Workspace shell。UI/UX §7.1。
 *
 * 3 カラム（sidebar / main / inspector）+ top bar + 下端の composer。
 * 幅による振る舞いの判定は ui-kit の `resolveLayout` に閉じ込めてある。
 */
import type { ReactNode, ReactElement } from 'react';
import { useShell } from '../state/ShellProvider.js';
import { Sidebar } from './Sidebar.js';
import { TopBar } from './TopBar.js';
import { Inspector } from './Inspector.js';
import { Composer, type ComposerConversation } from './Composer.js';

export function AppShell({
  children,
  conversation,
  inspector,
}: {
  children: ReactNode;
  /** 下端の composer が話す先。未接続なら composer が「繋がっていない」と言う。 */
  conversation?: ComposerConversation | undefined;
  /** §7.1 の Inspector に出す中身（Context / Evidence / Activity）。 */
  inspector?: ReactNode;
}): ReactElement {
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
        {/*
          §7.1 の Composer。**Main の下に置く。**
          Task Dock は別 window なので、本体を開いている人には見えない。
          ここが無いと、Workspace から Astra へ話しかける口が一つも無くなる。
        */}
        <Composer {...(conversation ? { conversation } : {})} />
      </div>
      <Inspector>{inspector}</Inspector>
    </div>
  );
}
