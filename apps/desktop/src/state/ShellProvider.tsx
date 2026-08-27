/**
 * Shell の共有状態。UI-0 の「shared state」。
 *
 * ここが持つのは **Surface の形**（どのタブか、sidebar は畳まれているか、
 * inspector は開いているか）だけ。業務データは各画面が持つ。
 */
import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import type { ReactNode, ReactElement } from 'react';
import { isTabId, resolveLayout, type LayoutDecision, type TabId } from '@astra/ui-kit';
import { useViewportWidth } from './useViewportWidth.js';

interface ShellContextValue {
  readonly activeTab: TabId;
  readonly layout: LayoutDecision;
  readonly inspectorOpen: boolean;
  /** タブを跨いで「これを見せる」を伝える。task → artifact の連続性に使う（UI-3）。 */
  readonly focusedTaskId: string | null;
  readonly focusedArtifactId: string | null;
  goToTab(tab: TabId): void;
  openTask(taskId: string): void;
  openArtifact(artifactId: string): void;
  toggleSidebar(): void;
  setInspectorOpen(open: boolean): void;
}

const ShellContext = createContext<ShellContextValue | null>(null);

export function ShellProvider({
  children,
  initialTab = 'home',
}: {
  children: ReactNode;
  initialTab?: TabId;
}): ReactElement {
  const [activeTab, setActiveTab] = useState<TabId>(initialTab);
  const [userCollapsed, setUserCollapsed] = useState(false);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [focusedTaskId, setFocusedTaskId] = useState<string | null>(null);
  const [focusedArtifactId, setFocusedArtifactId] = useState<string | null>(null);
  const width = useViewportWidth();

  // 幅からの判定は ui-kit に閉じ込める。各コンポーネントで px を比較しない。
  const layout = useMemo(() => resolveLayout(width, userCollapsed), [width, userCollapsed]);

  const goToTab = useCallback((tab: TabId) => {
    if (!isTabId(tab)) return;
    setActiveTab(tab);
  }, []);

  // 「この仕事を見せる」「この成果物を見せる」はタブ移動と一体で行う。
  // 移動だけして何も選ばれていない画面に落とすと、利用者が探し直すことになる。
  const openTask = useCallback((taskId: string) => {
    setFocusedTaskId(taskId);
    setActiveTab('work');
    /*
     * §7.1: 仕事を開いたら Inspector に Context / Evidence / Activity を出す。
     * 閉じる button しか無く、**開く経路が一つも無かった。**
     * 3 カラム目は在るのに、誰も見たことが無い状態だった。
     */
    setInspectorOpen(true);
  }, []);

  const openArtifact = useCallback((artifactId: string) => {
    setFocusedArtifactId(artifactId);
    setActiveTab('library');
  }, []);

  const value = useMemo<ShellContextValue>(
    () => ({
      activeTab,
      layout,
      inspectorOpen,
      focusedTaskId,
      focusedArtifactId,
      goToTab,
      openTask,
      openArtifact,
      toggleSidebar: () => setUserCollapsed((v) => !v),
      setInspectorOpen,
    }),
    [
      activeTab,
      layout,
      inspectorOpen,
      focusedTaskId,
      focusedArtifactId,
      goToTab,
      openTask,
      openArtifact,
    ],
  );

  return <ShellContext.Provider value={value}>{children}</ShellContext.Provider>;
}

export function useShell(): ShellContextValue {
  const value = useContext(ShellContext);
  if (!value) throw new Error('useShell must be used inside <ShellProvider>');
  return value;
}

/** shell の外（テスト・見本帳）で描いても落ちない版。 */
export function useOptionalShell(): ShellContextValue | null {
  return useContext(ShellContext);
}
