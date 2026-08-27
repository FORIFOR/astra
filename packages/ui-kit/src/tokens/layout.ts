/** Workspace のレイアウト。UI/UX §7.1・§7.2。 */

export const layout = {
  sidebar: { expanded: 208, collapsed: 64 },
  topBar: 56,
  /** これ以下に潰さない。潰すくらいなら inspector を畳む。 */
  mainMin: 640,
  inspector: 320,
  composer: { min: 48, max: 72 },
} as const;

/**
 * §7.2 のブレークポイント。
 * desktop MVP の最低幅は 720px。それ未満は別途 mobile 仕様。
 */
export const breakpoints = {
  /** sidebar collapsed / single column */
  compact: 720,
  /** inspector を drawer にする */
  medium: 960,
  /** sidebar + main + inspector の 3 column */
  wide: 1280,
} as const;

export type LayoutMode = 'unsupported' | 'compact' | 'medium' | 'wide';

/** 幅からレイアウトを決める。判定を各コンポーネントに散らさない。 */
export function layoutModeFor(width: number): LayoutMode {
  if (width < breakpoints.compact) return 'unsupported';
  if (width < breakpoints.medium) return 'compact';
  if (width < breakpoints.wide) return 'medium';
  return 'wide';
}

export interface LayoutDecision {
  readonly mode: LayoutMode;
  readonly sidebarWidth: number;
  readonly sidebarCollapsed: boolean;
  /** inspector を drawer として重ねるか（常設できないか） */
  readonly inspectorAsDrawer: boolean;
}

export function resolveLayout(width: number, userCollapsedSidebar: boolean): LayoutDecision {
  const mode = layoutModeFor(width);
  /*
   * §7.2: 960–1279 は「sidebar 64–208 切替」— 利用者が選べる。
   * compact（720–959）だけは常に畳む。main の最低幅 640px を守るため。
   * medium まで畳み込んでいた間、切替 button は灰色のまま押せなかった。
   */
  const collapsed = mode === 'compact' ? true : userCollapsedSidebar;
  return {
    mode,
    sidebarCollapsed: collapsed,
    sidebarWidth: collapsed ? layout.sidebar.collapsed : layout.sidebar.expanded,
    inspectorAsDrawer: mode !== 'wide',
  };
}

export const zIndex = {
  base: 0,
  sticky: 10,
  drawer: 20,
  popover: 30,
  dock: 40,
  toast: 50,
} as const;
