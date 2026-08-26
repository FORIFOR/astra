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
  goToTab(tab: TabId): void;
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
  const width = useViewportWidth();

  // 幅からの判定は ui-kit に閉じ込める。各コンポーネントで px を比較しない。
  const layout = useMemo(() => resolveLayout(width, userCollapsed), [width, userCollapsed]);

  const goToTab = useCallback((tab: TabId) => {
    if (!isTabId(tab)) return;
    setActiveTab(tab);
  }, []);

  const value = useMemo<ShellContextValue>(
    () => ({
      activeTab,
      layout,
      inspectorOpen,
      goToTab,
      toggleSidebar: () => setUserCollapsed((v) => !v),
      setInspectorOpen,
    }),
    [activeTab, layout, inspectorOpen, goToTab],
  );

  return <ShellContext.Provider value={value}>{children}</ShellContext.Provider>;
}

export function useShell(): ShellContextValue {
  const value = useContext(ShellContext);
  if (!value) throw new Error('useShell must be used inside <ShellProvider>');
  return value;
}
