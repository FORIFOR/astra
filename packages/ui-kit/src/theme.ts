/**
 * テーマ。UI/UX §17.1。
 *
 * 既定は `system`。OS 設定に従うのが B2B の期待値で、
 * アプリ独自の初期テーマを押し付けない。
 */
export type ThemeMode = 'system' | 'light' | 'dark';
export type ResolvedTheme = 'light' | 'dark';

export const THEME_MODES: readonly ThemeMode[] = ['system', 'light', 'dark'];
export const THEME_STORAGE_KEY = 'astra.theme';

export function isThemeMode(value: unknown): value is ThemeMode {
  return typeof value === 'string' && (THEME_MODES as readonly string[]).includes(value);
}

export function resolveTheme(mode: ThemeMode, systemPrefersDark: boolean): ResolvedTheme {
  if (mode === 'system') return systemPrefersDark ? 'dark' : 'light';
  return mode;
}

/**
 * `data-theme` を root に反映する。
 *
 * `system` のときは属性を**外す**。属性を付けたままにすると
 * `prefers-color-scheme` のメディアクエリが効かなくなる。
 */
export function applyTheme(
  root: { setAttribute(k: string, v: string): void; removeAttribute(k: string): void },
  mode: ThemeMode,
): void {
  if (mode === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', mode);
}
