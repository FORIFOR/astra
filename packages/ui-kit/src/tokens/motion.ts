/**
 * モーション。UI/UX §18。
 *
 * 無限 pulse を常用しない。Listening と録音中だけ、必要最小限に使う。
 * layout shift を避け、Card → Panel → Workspace は anchor 位置を保って拡大する。
 */

export interface MotionSpec {
  readonly durationMs: number;
  readonly easing: string;
  readonly note: string;
}

export const motion = {
  hover: {
    durationMs: 100,
    easing: 'ease-out',
    note: 'opacity と background のみ。位置やサイズを動かさない',
  },
  popover: { durationMs: 160, easing: 'ease-out', note: 'popover / drawer' },
  dockMorph: {
    durationMs: 200,
    easing: 'cubic-bezier(0.2, 0, 0, 1)',
    note: 'Dock の変形。position continuity を保つ',
  },
  workspaceExpand: {
    durationMs: 230,
    easing: 'cubic-bezier(0.2, 0, 0, 1)',
    note: '同一 Task の identity を維持したまま拡大する',
  },
  successAck: { durationMs: 400, easing: 'ease-out', note: 'checkmark を 1 回。loop 禁止' },
} as const satisfies Record<string, MotionSpec>;

export type MotionRole = keyof typeof motion;

/** §18: prefers-reduced-motion では morph を fade / instant へ簡略化する。 */
export const REDUCED_MOTION_DURATION_MS = 1;
