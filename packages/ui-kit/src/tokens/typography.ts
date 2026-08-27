/** タイポグラフィ。UI/UX §17.2。数字・KPI で monospace を乱用しない。 */

export interface TypeScale {
  readonly size: number;
  readonly weight: number;
  readonly lineHeight: number;
}

export const typography = {
  pageTitle: { size: 24, weight: 600, lineHeight: 1.25 },
  sectionTitle: { size: 16, weight: 600, lineHeight: 1.35 },
  cardTitle: { size: 14, weight: 600, lineHeight: 1.4 },
  body: { size: 14, weight: 400, lineHeight: 1.55 },
  secondary: { size: 13, weight: 400, lineHeight: 1.5 },
  micro: { size: 12, weight: 500, lineHeight: 1.4 },
} as const satisfies Record<string, TypeScale>;

export type TypeRole = keyof typeof typography;

/**
 * 既定は system UI font。日本語は Noto Sans CJK JP へ落ちる（§17.2）。
 * 独自 web font を先頭に置かない。起動直後の文字化けと FOUT を避ける。
 */
export const fontStacks = {
  sans: [
    '-apple-system',
    'BlinkMacSystemFont',
    '"Segoe UI"',
    'Roboto',
    '"Helvetica Neue"',
    '"Noto Sans CJK JP"',
    '"Hiragino Sans"',
    '"Yu Gothic UI"',
    'Meiryo',
    'sans-serif',
  ].join(', '),
  mono: ['ui-monospace', 'SFMono-Regular', '"SF Mono"', 'Menlo', 'Consolas', 'monospace'].join(
    ', ',
  ),
} as const;
