/**
 * WCAG のコントラスト比。UI/UX §19「主要テキスト/controls は WCAG AA 相当を目標」。
 *
 * トークンを目視で決めない。比率は計算できるので、テストで機械的に守る。
 */

/** WCAG 2.1: 通常テキストの AA。 */
export const AA_NORMAL_TEXT = 4.5;
/** 18pt 以上（または 14pt bold）の AA、および UI コンポーネント・図形の下限。 */
export const AA_LARGE_TEXT = 3;

function channels(hex: string): [number, number, number] {
  const normalized = hex.replace('#', '');
  const full =
    normalized.length === 3
      ? normalized
          .split('')
          .map((c) => c + c)
          .join('')
      : normalized;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) {
    throw new Error(`not a hex color: ${hex}`);
  }
  return [0, 2, 4].map((i) => Number.parseInt(full.slice(i, i + 2), 16) / 255) as [
    number,
    number,
    number,
  ];
}

const linearize = (c: number): number => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);

export function relativeLuminance(hex: string): number {
  const [r, g, b] = channels(hex).map(linearize) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

export function meetsAA(foreground: string, background: string, large = false): boolean {
  return contrastRatio(foreground, background) >= (large ? AA_LARGE_TEXT : AA_NORMAL_TEXT);
}
