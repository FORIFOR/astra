/**
 * Tauri コマンドの薄い入口。
 *
 * ブラウザ（テスト・Storybook・share-web）では Tauri が居ない。
 * ここで一度だけ判定し、居なければ **静かに何もしない**。
 * 各コンポーネントに `if (isTauri)` を撒くと、UI のロジックが
 * 実行環境の分岐で汚れて読めなくなる。
 */
import type { DockState } from '@astra/ui-kit';

interface TauriInternals {
  invoke?: unknown;
}

export function isTauri(): boolean {
  const internals = (globalThis as { __TAURI_INTERNALS__?: TauriInternals }).__TAURI_INTERNALS__;
  return typeof internals?.invoke === 'function';
}

async function call<T>(command: string, args?: Record<string, unknown>): Promise<T | null> {
  if (!isTauri()) return null;
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    return (await invoke(command, args)) as T;
  } catch (error) {
    // Dock の見た目の都合で落とさない。届かなければ何もしないだけ。
    console.warn(`host command ${command} failed`, error);
    return null;
  }
}

export interface LocalContext {
  readonly active_app: string | null;
  readonly window_title: string | null;
  readonly requires_permission: readonly string[];
}

/**
 * 資格情報の保管。Tauri では OS の資格情報ストア、ブラウザでは**保存しない**。
 *
 * ブラウザに安全な保管先が無い以上、localStorage へ置いて「保存できている」ことに
 * するより、保存しない方が正しい（再読み込みでサインアウトになるが、
 * refresh token をディスクに平文で残すより望ましい）。
 */
export const secrets = {
  set: (key: string, value: string) => call<void>('secret_set', { key, value }),
  get: (key: string) => call<string | null>('secret_get', { key }),
  delete: (key: string) => call<void>('secret_delete', { key }),
};

export const host = {
  showDock: (state?: DockState, contentHeight?: number) =>
    call<void>('dock_show', { state, contentHeight }),
  hideDock: () => call<void>('dock_hide'),
  setDockState: (state: DockState, contentHeight?: number) =>
    call<void>('dock_set_state', { state, contentHeight }),
  rememberDockPosition: () => call<void>('dock_remember_position'),
  contextSnapshot: () => call<LocalContext>('context_snapshot'),
};
