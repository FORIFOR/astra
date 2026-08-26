/**
 * テーマ。UI/UX §17.1。既定は system（OS 設定に従う）。
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode, ReactElement } from 'react';
import {
  THEME_STORAGE_KEY,
  TOKENS_CSS,
  applyTheme,
  isThemeMode,
  resolveTheme,
  type ResolvedTheme,
  type ThemeMode,
} from '@astra/ui-kit';

interface ThemeContextValue {
  readonly mode: ThemeMode;
  readonly resolved: ResolvedTheme;
  setMode(mode: ThemeMode): void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

const STYLE_ID = 'astra-tokens';

/**
 * 使える localStorage を返す。無ければ null。
 *
 * 「オブジェクトはあるがメソッドが無い」環境が実在する（一部のテスト環境や
 * 制限付き webview）ので、存在ではなくメソッドで判定する。
 * プライベートウィンドウでは getItem 自体が例外を投げることもある。
 */
function storage(): Storage | null {
  try {
    const candidate = globalThis.localStorage;
    return typeof candidate?.getItem === 'function' && typeof candidate.setItem === 'function'
      ? candidate
      : null;
  } catch {
    return null;
  }
}

function readStoredMode(): ThemeMode {
  try {
    const stored = storage()?.getItem(THEME_STORAGE_KEY);
    return isThemeMode(stored) ? stored : 'system';
  } catch {
    // テーマ如きでアプリを落とさない
    return 'system';
  }
}

function prefersDark(): boolean {
  return globalThis.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false;
}

export function ThemeProvider({ children }: { children: ReactNode }): ReactElement {
  const [mode, setModeState] = useState<ThemeMode>(readStoredMode);
  const [systemDark, setSystemDark] = useState<boolean>(prefersDark);

  // トークンは 1 度だけ挿す。生成元は @astra/ui-kit なので、ここでは中身を知らない。
  useEffect(() => {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = TOKENS_CSS;
    document.head.appendChild(style);
  }, []);

  useEffect(() => {
    const query = globalThis.matchMedia?.('(prefers-color-scheme: dark)');
    if (!query) return;
    const onChange = (event: MediaQueryListEvent): void => setSystemDark(event.matches);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);

  useEffect(() => {
    applyTheme(document.documentElement, mode);
  }, [mode]);

  const setMode = useCallback((next: ThemeMode) => {
    setModeState(next);
    try {
      storage()?.setItem(THEME_STORAGE_KEY, next);
    } catch {
      /* 保存できなくても動作は続ける */
    }
  }, []);

  const value = useMemo<ThemeContextValue>(
    () => ({ mode, resolved: resolveTheme(mode, systemDark), setMode }),
    [mode, systemDark, setMode],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const value = useContext(ThemeContext);
  if (!value) throw new Error('useTheme must be used inside <ThemeProvider>');
  return value;
}
