/** 余白・角丸・境界。UI/UX §17.3。 */

/**
 * 基準は 8px（§17.3）。`compact` の 4px だけが例外。
 * ここに 8 の倍数でない値を足さない。足したくなったら padding 側で扱う。
 */
export const space = {
  compact: 4,
  base: 8,
  lg: 16,
  panel: 24,
  section: 32,
} as const;

export const radius = {
  /** chips / 小さなボタン */
  small: 8,
  /** cards / panels */
  standard: 12,
  /** Task Dock（§17.3） */
  dock: 16,
  pill: 999,
} as const;

export const border = {
  hairline: 1,
} as const;

/**
 * card padding は 16–20、大きな panel は 24（§17.3）。
 * `cardLoose` の 20px は 8px グリッドから外れるが、仕様が明示している値なので許す。
 */
export const padding = {
  card: space.lg,
  cardLoose: 20,
  panel: space.panel,
} as const;

/**
 * Glassmorphism は Task Dock 等の floating surface に限定する（§17.3）。
 * 通常の Workspace は不透明 Surface。
 */
export const elevation = {
  flat: 'none',
  card: '0 1px 2px rgba(16, 24, 40, 0.06)',
  popover: '0 8px 24px rgba(16, 24, 40, 0.12)',
  dock: '0 12px 40px rgba(16, 24, 40, 0.24)',
} as const;

export const dockGlass = {
  backdropFilter: 'saturate(140%) blur(20px)',
} as const;
