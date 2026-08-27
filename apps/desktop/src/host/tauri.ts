/**
 * Tauri コマンドの薄い入口。
 *
 * ブラウザ（テスト・Storybook・share-web）では Tauri が居ない。
 * ここで一度だけ判定し、居なければ **静かに何もしない**。
 * 各コンポーネントに `if (isTauri)` を撒くと、UI のロジックが
 * 実行環境の分岐で汚れて読めなくなる。
 */
import type { DockState } from '@astra/ui-kit';

export type HostVoiceMode =
  'idle' | 'connecting' | 'listening' | 'thinking' | 'speaking' | 'interrupted' | 'error';

export interface CapturedVoice {
  readonly audioBase64: string;
  readonly sampleRateHz: 16000;
  readonly durationMs: number;
}

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
      /** サインインの relay（LINE / Apple web）は code ではなく ID トークンを返す。 */
      id_token?: string;
      display_name?: string;
    }>('oauth_await_callback'),
  cancel: () => call<void>('oauth_cancel'),
  /** 外のブラウザで開く。アプリ内 webview では開かない（RFC 8252 §8.12）。 */
  openBrowser: (url: string) => callStrict<void>('oauth_open_browser', { url }),
};

/**
 * 端末でできること。正本 §25。
 *
 * サーバ側の report と違い、**これは起動を止めない。**
 * マイクの無い機械でも Astra は使える（文字で頼める）。
 * 止める代わりに、できないことを名指しで言う。
 */
export interface DeviceCapability {
  readonly capability: string;
  readonly available: boolean;
  /** 使えないときの理由。**available=false なら必ず入る。** */
  readonly reason: string | null;
  readonly implementation: string | null;
}

export const capabilities = {
  /** ブラウザでは端末の能力を答えられない。空を返す（「無い」ではない）。 */
  report: () => call<DeviceCapability[]>('capability_report'),
};

export const shortcuts = {
  status: () => call<ShortcutStatus[]>('shortcut_status'),
  // 失敗は握り潰さない。変えたつもりで効いていない状態を作らない。
  rebind: (id: string, code: string, modifiers: ShortcutStatus['modifiers']) =>
    callStrict<ShortcutStatus>('shortcut_rebind', { id, code, modifiers }),
  onHold,
};

/**
 * Dock から本体へ。UI/UX §2.2 の「深く扱う必要がある時だけ開く」。
 *
 * Dock の「詳しく見る」はこれを呼ぶ。**押せるのに何も起きない button を残さない。**
 * ブラウザでは本体の窓が無いので、何もしないことを返す。
 */
export const workspace = {
  open: (taskId?: string) => call<void>('workspace_open', { taskId: taskId ?? null }),
  /** 本体側が「この仕事を開いて」を受ける。Tauri が居なければ何も購読しない。 */
  onOpenTask: async (handler: (taskId: string | null) => void): Promise<() => void> => {
    if (!isTauri()) return () => undefined;
    try {
      const { listen } = await import('@tauri-apps/api/event');
      return await listen<{ taskId: string | null }>('astra://open-task', (event) => {
        handler(event.payload.taskId);
      });
    } catch (error) {
      console.warn('could not subscribe to open-task', error);
      return () => undefined;
    }
  },
};

/**
 * 声。UI/UX §4.1・§23。
 *
 * 取り込みは Rust（`voice.rs`）。ここは「始めて」「止めて」と、
 * 音量と途中経過を受け取る口だけ。
 * ブラウザには mic の取り込みが無いので、**購読できないことを返す**
 * （聞いているふりをしない）。
 */
export const voice = {
  start: () => callStrict<void>('voice_start'),
  stop: () => call<CapturedVoice>('voice_stop'),
  setMode: (mode: HostVoiceMode) => call<void>('voice_set_mode', { mode }),
  setOutputLevel: (output: number) => call<void>('voice_set_output_level', { output }),
  onLevel: async (handler: (level: { input: number; output: number }) => void) => {
    if (!isTauri()) return () => undefined;
    const { listen } = await import('@tauri-apps/api/event');
    return listen<{ input: number; output: number }>('voice:audio-level', (e) =>
      handler(e.payload),
    );
  },
  onTranscript: async (
    handler: (event: { type: 'partial' | 'final'; text: string }) => void,
  ): Promise<() => void> => {
    if (!isTauri()) return () => undefined;
    const { listen } = await import('@tauri-apps/api/event');
    return listen<{ type: 'partial' | 'final'; text: string }>('voice:transcript', (e) =>
      handler(e.payload),
    );
  },
  onUnavailable: async (handler: (reason: string) => void): Promise<() => void> => {
    if (!isTauri()) return () => undefined;
    const { listen } = await import('@tauri-apps/api/event');
    return listen<{ reason: string }>('voice:transcript-unavailable', (e) =>
      handler(e.payload.reason),
    );
  },
  onMode: async (handler: (mode: HostVoiceMode) => void): Promise<() => void> => {
    if (!isTauri()) return () => undefined;
    const { listen } = await import('@tauri-apps/api/event');
    return listen<{ mode: HostVoiceMode }>('voice:mode', (event) => handler(event.payload.mode));
  },
};

export const host = {
  showDock: (state?: DockState, contentHeight?: number) =>
    call<void>('dock_show', { state, contentHeight }),
  hideDock: () => call<void>('dock_hide'),
  /** 形を合わせる。`jump` は上↔下の切替（morph せず一気に置く。画面側がフェードする）。 */
  setDockState: (state: DockState, contentHeight?: number, jump = false) =>
    call<void>('dock_set_state', { state, contentHeight, jump }),
  /** 入力カードに広げたとき、打てるように焦点を移す。ピルのままでは呼ばない。 */
  focusDock: () => call<void>('dock_focus'),
  /**
   * Option+Space。Rust は「押された」と伝えるだけで、ピル ↔ カードのどちらへ行くかは
   * 画面側の状態機械が決める（録音中なら何もしない等）。
   */
  onDockToggle: async (handler: () => void): Promise<() => void> => {
    if (!isTauri()) return () => undefined;
    try {
      const { listen } = await import('@tauri-apps/api/event');
      return await listen('dock:toggle', () => handler());
    } catch (error) {
      console.warn('could not subscribe to the dock toggle', error);
      return () => undefined;
    }
  },
  rememberDockPosition: () => call<void>('dock_remember_position'),
  contextSnapshot: () => call<LocalContext>('context_snapshot'),
};

/** Rust 側が Dock を出すのにかかった時間（§23 Dock summon）。 */
export const dockMetrics = {
  async onSummoned(handler: (elapsedMs: number) => void): Promise<() => void> {
    if (!isTauri()) return () => undefined;
    const { listen } = await import('@tauri-apps/api/event');
    return listen<{ elapsed_ms: number }>('dock:summoned', (e) => handler(e.payload.elapsed_ms));
  },
};

/** 入力装置。UI/UX §12.1 の Audio sources（Deepgram の MicSelector 相当）。ブラウザでは空。 */
export interface InputDevice {
  readonly id: string;
  readonly name: string;
  readonly is_default: boolean;
}

export const audio = {
  async inputDevices(): Promise<readonly InputDevice[]> {
    if (!isTauri()) return [];
    return callStrict<InputDevice[]>('audio_input_devices');
  },
};

// ---------------------------------------------------------------- meeting audio

export type MeetingLinkState = 'connecting' | 'online' | 'offline' | 'reconnecting';

export interface MeetingLinkEvent {
  readonly meetingId: string;
  readonly state: MeetingLinkState;
  /** まだ送れていない音の長さ。オフラインの間に増える。 */
  readonly pendingMs: number;
}

export interface RecoverableMeeting {
  readonly meetingId: string;
  readonly startedAt: string;
  readonly recordedMs: number;
  readonly uploadedMs: number;
}

/**
 * 会議の音声は Rust が取り込み、手元に残しながら gateway へ送る（正本 §25）。
 * webview は音を持たない。ここは指示と状態の受け渡しだけ。
 */
export const meetingCapture = {
  start: (meetingId: string, baseUrl: string, token: string) =>
    callStrict<void>('meeting_capture_start', { meetingId, baseUrl, token }),
  /** access token が回ったら渡す（長い会議で切れないように）。 */
  updateToken: (token: string) => call<void>('meeting_capture_token', { token }),
  setPaused: (paused: boolean) => call<void>('meeting_capture_pause', { paused }),
  stop: () => call<void>('meeting_capture_stop'),
  recoverable: async (): Promise<RecoverableMeeting[]> =>
    (await call<RecoverableMeeting[]>('meeting_recoverable')) ?? [],
  reupload: (meetingId: string, baseUrl: string, token: string) =>
    callStrict<number>('meeting_reupload', { meetingId, baseUrl, token }),
  discard: (meetingId: string) => call<void>('meeting_discard', { meetingId }),
  onLink: async (handler: (event: MeetingLinkEvent) => void): Promise<() => void> => {
    if (!isTauri()) return () => undefined;
    try {
      const { listen } = await import('@tauri-apps/api/event');
      return await listen<MeetingLinkEvent>('meeting:link', (event) => handler(event.payload));
    } catch (error) {
      console.warn('could not subscribe to the meeting link', error);
      return () => undefined;
    }
  },
};
