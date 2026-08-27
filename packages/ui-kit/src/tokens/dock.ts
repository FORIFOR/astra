/**
 * Task Dock の geometry と配置。UI/UX §4.1・§4.2。
 *
 * この値は **Rust 側の window サイズと React 側の CSS の両方**が使う。
 * ここを唯一の正とし、Rust の定数は `scripts/gen-dock-geometry.mjs` が生成する。
 * 手で二重に持つと必ずずれる。
 */

/**
 * Global Interaction State Machine のうち、Dock が形を変える状態（§3・§4.1）。
 *
 * `idle` / `pill` は上部の Voice OS 型ピル（何もしていないときは徹底して静か）、
 * `recording` / `processing` は下部の Recording Dock。残りは上部にぶら下がる入力カード。
 */
export const DOCK_STATES = [
  'idle',
  'pill',
  'menu',
  'ready',
  'typing',
  'listening',
  'contextPeek',
  'working',
  'recording',
  'processing',
] as const;
export type DockState = (typeof DOCK_STATES)[number];

/** 配置。上（メニューバー直下）か下（macOS Dock の少し上）か。 */
export const DOCK_PLACEMENTS = ['top', 'bottom'] as const;
export type DockPlacement = (typeof DOCK_PLACEMENTS)[number];

/** 録音のときだけ下へ降りる。それ以外は「常に居る入口」として上に留まる。 */
export function dockPlacementFor(state: DockState): DockPlacement {
  return state === 'recording' || state === 'processing' ? 'bottom' : 'top';
}

export interface DockSize {
  readonly width: number;
  readonly minHeight: number;
  readonly maxHeight: number;
}

export const dockGeometry = {
  /** 上部ピル（通常）: option ⌥ D 長押しで音声入力。メニューバーに接する */
  idle: { width: 320, minHeight: 32, maxHeight: 32 },
  /** 上部ピル（聞いています / 考えています）: 波形と一言 */
  pill: { width: 360, minHeight: 40, maxHeight: 40 },
  /** ピルを押したときのクイックメニュー（文字で頼む / 声で頼む / 会議を記録） */
  menu: { width: 320, minHeight: 156, maxHeight: 156 },
  /** §4.1 Ready: 560 × 56 */
  ready: { width: 560, minHeight: 56, maxHeight: 56 },
  /** §4.1 Typing expanded: 640 × 96–140（multi-line 最大 4 行） */
  typing: { width: 640, minHeight: 96, maxHeight: 140 },
  /** §4.1 Listening: 560 × 96（live transcript 2 行 + minimal waveform） */
  listening: { width: 560, minHeight: 96, maxHeight: 96 },
  /** §4.1 Context peek: 640 × 140–220 */
  contextPeek: { width: 640, minHeight: 140, maxHeight: 220 },
  /** §4.1 Work card detached: 520–620 × 最大 520 */
  working: { width: 620, minHeight: 160, maxHeight: 520 },
  /** 下部 Recording Dock: ● 03:42 CC ⏸ ■。CC で Transcript が上に足される */
  recording: { width: 320, minHeight: 44, maxHeight: 320 },
  /** 停止直後の「✓ 会議を保存しました」 */
  processing: { width: 260, minHeight: 36, maxHeight: 36 },
} as const satisfies Record<DockState, DockSize>;

/** §4.1 Typing: multi-line は最大 4 行。 */
export const DOCK_MAX_INPUT_LINES = 4;

/**
 * 配置。§4.2。
 *
 * 既定は primary display の下部中央。メニューバー / タスクバーと重ならない。
 */
export const dockPlacement = {
  /** 画面下端からの距離。§4.2 は 48–72px。 */
  bottomOffsetMin: 48,
  bottomOffsetMax: 72,
  bottomOffsetDefault: 56,
  /** 録音中の Recording Dock は macOS Dock とぶつからないよう少し上 */
  recordingBottomOffset: 68,
  /** 上部ピルはメニューバー直下に接する（作業領域の上端） */
  topOffset: 0,
  /** 画面端に寄せすぎない余白 */
  edgeMargin: 16,
} as const;

export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/**
 * Dock の既定位置を求める。作業領域（メニューバー等を除いた領域）を渡す。
 *
 * 端に寄りすぎないよう clamp する。作業領域が Dock より狭い場合でも
 * 画面外へ出さない（外へ出ると二度と掴めなくなる）。
 */
export function defaultDockPosition(
  workArea: Rect,
  size: { width: number; height: number },
  // 既定値が `as const` のリテラル型を引き継がないよう、型を明示する
  bottomOffset: number = dockPlacement.bottomOffsetDefault,
): { x: number; y: number } {
  const offset = Math.min(
    Math.max(bottomOffset, dockPlacement.bottomOffsetMin),
    dockPlacement.bottomOffsetMax,
  );
  const centered = workArea.x + Math.round((workArea.width - size.width) / 2);
  const maxX = workArea.x + workArea.width - size.width - dockPlacement.edgeMargin;
  const minX = workArea.x + dockPlacement.edgeMargin;
  const x = Math.round(clamp(centered, Math.min(minX, maxX), Math.max(minX, maxX)));

  const desiredY = workArea.y + workArea.height - size.height - offset;
  const maxY = workArea.y + workArea.height - size.height;
  const y = Math.round(clamp(desiredY, workArea.y, Math.max(workArea.y, maxY)));

  return { x, y };
}

/**
 * ユーザーが動かした位置を、その display の作業領域内へ収める。§4.2
 * 「ユーザーが Dock を移動した場合はその display 内で位置を記憶」。
 */
export function clampToWorkArea(
  position: { x: number; y: number },
  workArea: Rect,
  size: { width: number; height: number },
): { x: number; y: number } {
  const maxX = workArea.x + workArea.width - size.width;
  const maxY = workArea.y + workArea.height - size.height;
  return {
    x: Math.round(clamp(position.x, workArea.x, Math.max(workArea.x, maxX))),
    y: Math.round(clamp(position.y, workArea.y, Math.max(workArea.y, maxY))),
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/**
 * Esc の扱い。§4.4。
 *
 * 1 回目は縮小、2 回目で dismiss。**実行中の Task はキャンセルしない。**
 * Dismiss と Cancel を同じ操作にしない（取り消しは明示的な「停止」から）。
 */
export type EscapeOutcome = 'shrink' | 'dismiss' | 'ignored';

export function escapeOutcome(state: DockState, alreadyShrunk: boolean): EscapeOutcome {
  // ピルは既に一番静かな姿。録音は Esc で止めない（止めるのは明示的な ■ から）
  if (state === 'idle' || state === 'recording' || state === 'processing') return 'ignored';
  if (state === 'ready' || state === 'pill' || state === 'menu') return 'dismiss';
  return alreadyShrunk ? 'dismiss' : 'shrink';
}

/**
 * 対話状態（UI/UX §3）から Dock の geometry を決める。
 *
 * §3 の状態は「ユーザーに何を見せているか」、geometry は「window の形」。
 * 1:1 ではないので、対応をここに 1 つだけ置く。各所で分岐させない。
 */
export type InteractionState =
  | 'HIDDEN'
  /** 上部ピル。何もしていない。入口だけが見えている */
  | 'IDLE'
  | 'READY'
  | 'LISTENING'
  | 'TYPING'
  | 'UNDERSTANDING'
  | 'WORKING'
  | 'WAITING_APPROVAL'
  | 'RESULT'
  | 'FAILED_RECOVERABLE'
  | 'FAILED_BLOCKED'
  | 'MINIMIZED'
  /** 会議を録っている。下部の Recording Dock */
  | 'RECORDING'
  /** 停止直後。保存を伝えて上へ戻る */
  | 'PROCESSING';

/**
 * 面の種類。`pill` は上部の細いピル（入力欄を持たない）、`card` は入力カード。
 * 押している間だけ話す（push-to-talk）はピルのまま聞き、結果が要るときだけカードに広がる。
 */
export type DockSurface = 'pill' | 'card' | 'menu';

export function dockGeometryFor(
  state: InteractionState,
  contextExpanded = false,
  surface: DockSurface = 'card',
): DockState {
  if (state === 'IDLE') return surface === 'menu' ? 'menu' : 'idle';
  if (state === 'RECORDING') return 'recording';
  if (state === 'PROCESSING') return 'processing';
  if (surface === 'pill' && (state === 'LISTENING' || state === 'UNDERSTANDING')) return 'pill';
  if (contextExpanded) return 'contextPeek';
  switch (state) {
    case 'LISTENING':
      return 'listening';
    case 'TYPING':
      return 'typing';
    case 'UNDERSTANDING':
    case 'WORKING':
    case 'WAITING_APPROVAL':
    case 'RESULT':
    case 'FAILED_RECOVERABLE':
    case 'FAILED_BLOCKED':
      // 進捗・承認・結果は同じ card 面で見せる（§6）
      return 'working';
    case 'HIDDEN':
    case 'MINIMIZED':
    case 'READY':
      return 'ready';
  }
}

/**
 * §3 UNDERSTANDING は 0.3〜1.2 秒程度の短い status。
 * spinner だけの状態を作らないための上限。
 */
export const UNDERSTANDING_MIN_MS = 300;
export const UNDERSTANDING_MAX_MS = 1200;

/**
 * floating surface（Task Dock / Voice HUD）の面。§17.3 が Glassmorphism を許す唯一の場所。
 *
 * 値は Deepgram 公式 `@deepgram/ui` の dark scheme（styles.css）そのまま。
 * **動きと面は Deepgram、幾何と accent は Astra。** brand の緑（#13ef93）は取らない。
 * 本体の Workspace はこれを使わない（不透明 surface のまま）。
 */
export const floatingSurface = {
  background: 'rgba(24, 24, 28, 0.92)',
  card: '#222228',
  input: '#1e1e24',
  foreground: '#ffffff',
  muted: '#8b8b9a',
  border: 'rgba(255, 255, 255, 0.08)',
  shadow: '0 8px 32px rgba(0, 0, 0, 0.5)',
  /** Deepgram の --dg-va-padding / --dg-va-fab-size */
  padding: 16,
  fab: 56,
} as const;
