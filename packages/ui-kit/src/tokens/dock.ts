/**
 * Task Dock の geometry と配置。UI/UX §4.1・§4.2。
 *
 * この値は **Rust 側の window サイズと React 側の CSS の両方**が使う。
 * ここを唯一の正とし、Rust の定数は `scripts/gen-dock-geometry.mjs` が生成する。
 * 手で二重に持つと必ずずれる。
 */

/** Global Interaction State Machine のうち、Dock が形を変える状態（§3・§4.1）。 */
export const DOCK_STATES = ['ready', 'typing', 'listening', 'contextPeek', 'working'] as const;
export type DockState = (typeof DOCK_STATES)[number];

export interface DockSize {
  readonly width: number;
  readonly minHeight: number;
  readonly maxHeight: number;
}

export const dockGeometry = {
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
  if (state === 'ready') return 'dismiss';
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
  | 'READY'
  | 'LISTENING'
  | 'TYPING'
  | 'UNDERSTANDING'
  | 'WORKING'
  | 'WAITING_APPROVAL'
  | 'RESULT'
  | 'FAILED_RECOVERABLE'
  | 'FAILED_BLOCKED'
  | 'MINIMIZED';

export function dockGeometryFor(state: InteractionState, contextExpanded = false): DockState {
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
