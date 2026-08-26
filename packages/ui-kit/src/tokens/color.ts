/**
 * 色トークン。UI/UX §17.1。
 *
 * 追加した token（仕様の表には無いが、無いと AA を満たせない）:
 *   accentOn  — accent を背景にしたときの前景色。
 *     dark の accent (#8A7DFF) 上の白は 3.25:1 しかなく、通常テキストの AA(4.5) に届かない。
 *     暗い前景に倒すと 5.81:1 になる。primary button は accent 背景なので必須。
 *   focusRing / overlay / shadow — §18・§19 が要求する挙動に必要。
 */

export interface ColorTokens {
  /** app background */
  readonly canvas: string;
  /** cards / panels */
  readonly surface: string;
  /** surface の上にもう一段重ねる面（popover 等） */
  readonly surfaceRaised: string;
  readonly text: string;
  readonly muted: string;
  readonly border: string;
  /** selection / primary action only（§17.1） */
  readonly accent: string;
  /** accent を背景にしたときの前景 */
  readonly accentOn: string;
  readonly success: string;
  readonly warning: string;
  readonly danger: string;
  /** focus ring。§19「focus ring を消さない」 */
  readonly focusRing: string;
  /** modal 等の背面 */
  readonly overlay: string;
}

export const lightColors: ColorTokens = {
  canvas: '#F7F8FA',
  surface: '#FFFFFF',
  surfaceRaised: '#FFFFFF',
  text: '#17191D',
  muted: '#667085',
  border: '#E6E8EC',
  accent: '#5B4CF0',
  accentOn: '#FFFFFF',
  success: '#18794E',
  warning: '#B54708',
  danger: '#B42318',
  focusRing: '#5B4CF0',
  overlay: 'rgba(15, 17, 21, 0.45)',
};

export const darkColors: ColorTokens = {
  canvas: '#0F1115',
  surface: '#171A20',
  surfaceRaised: '#1D2129',
  text: '#F2F4F7',
  muted: '#98A2B3',
  border: '#2B3038',
  accent: '#8A7DFF',
  // 白 (3.25:1) では AA に届かないので、暗い前景に倒す (5.81:1)
  accentOn: '#0F1115',
  success: '#3CCB7F',
  warning: '#F4B860',
  danger: '#FF746C',
  focusRing: '#8A7DFF',
  overlay: 'rgba(0, 0, 0, 0.6)',
};

export const palettes = { light: lightColors, dark: darkColors } as const;

/** テキストとして使うトークン。コントラスト検査の対象。 */
export const FOREGROUND_TOKENS = [
  'text',
  'muted',
  'accent',
  'success',
  'warning',
  'danger',
] as const satisfies readonly (keyof ColorTokens)[];

/** 背景として使うトークン。 */
export const BACKGROUND_TOKENS = [
  'canvas',
  'surface',
  'surfaceRaised',
] as const satisfies readonly (keyof ColorTokens)[];
