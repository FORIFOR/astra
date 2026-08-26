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

/**
 * 失敗を呼び出し側へ返す版。
 *
 * `call` は見た目の都合で落とさないために失敗を飲むが、
 * **設定の変更は飲んではいけない。**「取られている組み合わせを選んだ」ことを
 * 黙って握り潰すと、変えたつもりで効いていない状態になる。
 */
async function callStrict<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  if (!isTauri()) throw new Error('この環境では変更できません');
  const { invoke } = await import('@tauri-apps/api/core');
  return (await invoke(command, args)) as T;
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

/** §20: いま効いているショートカット。Rust 側の登録結果をそのまま持つ。 */
export interface ShortcutStatus {
  readonly id: string;
  readonly label: string;
  /** 効いている割り当て。登録できていなければ null。 */
  readonly code: string | null;
  readonly modifiers: { primary: boolean; alt: boolean; shift: boolean; control: boolean };
  /** 既定を使えているか。false なら OS / IME に取られている。 */
  readonly usingDefault: boolean;
  readonly alternates: readonly {
    code: string;
    modifiers: { primary: boolean; alt: boolean; shift: boolean; control: boolean };
  }[];
}

/**
 * 押している間だけ効くショートカット（push-to-talk）。
 *
 * ブラウザには global shortcut が無いので、購読できないときは
 * **何も購読していないことを返す**。効いているふりをしない。
 */
async function onHold(handler: (id: string, pressed: boolean) => void): Promise<() => void> {
  if (!isTauri()) return () => undefined;
  try {
    const { listen } = await import('@tauri-apps/api/event');
    return await listen<{ id: string; pressed: boolean }>('astra://shortcut-hold', (event) => {
      handler(event.payload.id, event.payload.pressed);
    });
  } catch (error) {
    console.warn('could not subscribe to push-to-talk', error);
    return () => undefined;
  }
}

/**
 * OS の許可。UI/UX §22。
 *
 * 開けたかどうかしか返らない。**許可されたことは、こちらからは分からない。**
 * 失敗を握り潰すと「押したのに何も起きない」になるので strict で呼ぶ。
 */
export const permissions = {
  openSettings: (permission: string) =>
    callStrict<void>('permission_open_settings', { permission }),
};

/**
 * OS への通知。UI/UX §16。
 *
 * **出せなかったら投げる。**握り潰すと、画面は「知らせた」と思い込んだまま、
 * 利用者には何も届かない。
 */
export const notifications = {
  send: (severity: string, title: string, body: string) =>
    callStrict<void>('notify_send', { severity, title, body }),
};

/**
 * 認可の折り返しを待ち受ける。RFC 8252。
 *
 * **交換も保管もここではしない。**このプロセスは code と state を
 * 右から左へ渡すだけ（`@astra/oauth` が続きをやる）。
 */
export const oauthCallback = {
  /** 待ち受けを開き、実際の折り返し先を返す。port は OS が選ぶ。 */
  listen: () => callStrict<{ redirectUri: string; port: number }>('oauth_listen'),
  /** 1 回だけ受け取る。受け取ったら閉じる。 */
  await: () =>
    callStrict<{
      code?: string;
      state?: string;
      error?: string;
      error_description?: string;
    }>('oauth_await_callback'),
  cancel: () => call<void>('oauth_cancel'),
};

export const shortcuts = {
  status: () => call<ShortcutStatus[]>('shortcut_status'),
  // 失敗は握り潰さない。変えたつもりで効いていない状態を作らない。
  rebind: (id: string, code: string, modifiers: ShortcutStatus['modifiers']) =>
    callStrict<ShortcutStatus>('shortcut_rebind', { id, code, modifiers }),
  onHold,
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
