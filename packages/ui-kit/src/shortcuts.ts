/**
 * キーボードショートカット。UI/UX §20。
 *
 * **表を 1 箇所に置く。** ここが正で、Rust の global shortcut も、
 * 画面側の keydown も、設定画面もここを読む。表を写すと、
 * 「設定で変えたのに効かない」「OS と衝突しても誰も気付かない」が起きる。
 *
 * §20 は 3 つを要求している:
 *   1. 表のとおりに効くこと
 *   2. Settings で変更できること
 *   3. OS / IME と衝突したら、初回設定で**代替候補を出す**こと
 *
 * 3 が要るのは、Option+Space も Ctrl+Alt+Space も、
 * IME の切り替えや Spotlight とぶつかることが珍しくないため。
 * 「登録できませんでした」で終わらせると、ショートカットは
 * 二度と効かないまま放置される。
 */

export type Platform = 'macos' | 'windows' | 'linux';

/** 押されている修飾キー。OS の呼び名ではなく役割で持つ。 */
export interface Modifiers {
  /** macOS の Command、Windows/Linux の Ctrl。 */
  readonly primary: boolean;
  readonly alt: boolean;
  readonly shift: boolean;
  /** macOS で Control を明示的に要求するとき。 */
  readonly control: boolean;
}

export interface Binding {
  readonly modifiers: Modifiers;
  /** `KeyboardEvent.code` に合わせる。配列レイアウトに依存しないため。 */
  readonly code: string;
}

/** ショートカットが効く面。global は OS 全体、surface はアプリの面の中。 */
export type ShortcutScope = 'global' | 'surface';

export interface ShortcutSpec {
  readonly id: string;
  /** 何が起きるか。設定画面にそのまま出す。 */
  readonly label: string;
  readonly scope: ShortcutScope;
  /** 押している間だけ効くもの（push-to-talk）。 */
  readonly hold: boolean;
  readonly defaults: Readonly<Record<Platform, Binding>>;
  /** 既定が使えないときに出す代替候補。上から順に薦める。 */
  readonly alternates: Readonly<Record<Platform, readonly Binding[]>>;
}

const NONE: Modifiers = { primary: false, alt: false, shift: false, control: false };

function mod(over: Partial<Modifiers>): Modifiers {
  return { ...NONE, ...over };
}

const key = (code: string, modifiers: Partial<Modifiers> = {}): Binding => ({
  code,
  modifiers: mod(modifiers),
});

/**
 * §20 の表。**行を減らさない。**実装が追い付いていない行があるなら、
 * 表から消すのではなく `SUPPORTED` の方を直す。
 */
export const SHORTCUTS = [
  {
    id: 'dock.toggle',
    label: 'Task Dock を開く / 閉じる',
    scope: 'global',
    hold: false,
    defaults: {
      // §20: macOS は Option+Space、Windows は Ctrl+Alt+Space
      macos: key('Space', { alt: true }),
      windows: key('Space', { primary: true, alt: true }),
      linux: key('Space', { primary: true, alt: true }),
    },
    alternates: {
      // Option+Space は IME 切り替え、Cmd+Space は Spotlight と当たりやすい
      macos: [
        key('Space', { alt: true, shift: true }),
        key('KeyJ', { primary: true, shift: true }),
        key('Period', { primary: true, alt: true }),
      ],
      windows: [
        key('Space', { primary: true, shift: true }),
        key('KeyJ', { primary: true, alt: true }),
        key('Period', { primary: true, alt: true }),
      ],
      linux: [
        key('Space', { primary: true, shift: true }),
        key('KeyJ', { primary: true, alt: true }),
        key('Period', { primary: true, alt: true }),
      ],
    },
  },
  {
    id: 'dock.pushToTalk',
    label: '押している間だけ話す',
    scope: 'global',
    hold: true,
    defaults: {
      macos: key('KeyD', { alt: true }),
      windows: key('KeyD', { primary: true, alt: true }),
      linux: key('KeyD', { primary: true, alt: true }),
    },
    alternates: {
      macos: [key('KeyD', { alt: true, shift: true }), key('Backquote', { alt: true })],
      windows: [key('KeyD', { primary: true, shift: true }), key('Backquote', { primary: true })],
      linux: [key('KeyD', { primary: true, shift: true }), key('Backquote', { primary: true })],
    },
  },
  {
    id: 'dock.send',
    label: '送る',
    scope: 'surface',
    hold: false,
    defaults: {
      macos: key('Enter'),
      windows: key('Enter'),
      linux: key('Enter'),
    },
    alternates: {
      macos: [key('Enter', { primary: true })],
      windows: [key('Enter', { primary: true })],
      linux: [key('Enter', { primary: true })],
    },
  },
  {
    id: 'dock.newline',
    label: '改行する',
    scope: 'surface',
    hold: false,
    defaults: {
      macos: key('Enter', { shift: true }),
      windows: key('Enter', { shift: true }),
      linux: key('Enter', { shift: true }),
    },
    alternates: { macos: [], windows: [], linux: [] },
  },
  {
    id: 'surface.dismiss',
    label: '今の面を閉じる',
    scope: 'surface',
    hold: false,
    defaults: {
      macos: key('Escape'),
      windows: key('Escape'),
      linux: key('Escape'),
    },
    alternates: { macos: [], windows: [], linux: [] },
  },
  {
    id: 'context.open',
    label: 'この依頼で使う情報を開く',
    scope: 'surface',
    hold: false,
    defaults: {
      macos: key('KeyC', { primary: true, shift: true }),
      windows: key('KeyC', { primary: true, shift: true }),
      linux: key('KeyC', { primary: true, shift: true }),
    },
    alternates: {
      macos: [key('KeyK', { primary: true, shift: true })],
      windows: [key('KeyK', { primary: true, shift: true })],
      linux: [key('KeyK', { primary: true, shift: true })],
    },
  },
] as const satisfies readonly ShortcutSpec[];

export type ShortcutId = (typeof SHORTCUTS)[number]['id'];

export function shortcutSpec(id: ShortcutId): ShortcutSpec {
  const found = SHORTCUTS.find((s) => s.id === id);
  // 型で塞いであるが、設定ファイル経由の値が来たときに黙って undefined を返さない
  if (!found) throw new Error(`unknown shortcut: ${id}`);
  return found;
}

export function currentPlatform(userAgent?: string): Platform {
  const ua = userAgent ?? globalThis.navigator?.userAgent ?? '';
  if (/Mac|iPhone|iPad/i.test(ua)) return 'macos';
  if (/Win/i.test(ua)) return 'windows';
  return 'linux';
}

export function defaultBinding(id: ShortcutId, platform: Platform): Binding {
  return shortcutSpec(id).defaults[platform];
}

/** 設定で上書きされた分。id → binding。 */
export type BindingOverrides = Readonly<Partial<Record<ShortcutId, Binding>>>;

export function bindingFor(
  id: ShortcutId,
  platform: Platform,
  overrides: BindingOverrides = {},
): Binding {
  return overrides[id] ?? defaultBinding(id, platform);
}

/** キーイベントの形。React の合成イベントも DOM のものも、これを満たす。 */
export interface KeyLike {
  readonly code: string;
  readonly metaKey: boolean;
  readonly ctrlKey: boolean;
  readonly altKey: boolean;
  readonly shiftKey: boolean;
}

function modifiersOf(event: KeyLike, platform: Platform): Modifiers {
  return {
    primary: platform === 'macos' ? event.metaKey : event.ctrlKey,
    alt: event.altKey,
    shift: event.shiftKey,
    // macOS だけ Control が primary と別物になる
    control: platform === 'macos' ? event.ctrlKey : false,
  };
}

/**
 * この event が binding に一致するか。
 *
 * **余分な修飾キーが付いていたら一致させない。** Shift+Enter を Enter と
 * みなすと、改行のつもりで送信してしまう。
 */
export function matchesBinding(event: KeyLike, binding: Binding, platform: Platform): boolean {
  if (event.code !== binding.code) return false;
  const actual = modifiersOf(event, platform);
  return (
    actual.primary === binding.modifiers.primary &&
    actual.alt === binding.modifiers.alt &&
    actual.shift === binding.modifiers.shift &&
    actual.control === binding.modifiers.control
  );
}

/** どのショートカットが押されたか。**先に定義された方が勝つのではなく、一致は 1 つだけ。** */
export function resolveShortcut(
  event: KeyLike,
  platform: Platform,
  overrides: BindingOverrides = {},
  scope?: ShortcutScope,
): ShortcutId | null {
  const hits = SHORTCUTS.filter(
    (spec) =>
      (scope === undefined || spec.scope === scope) &&
      matchesBinding(event, bindingFor(spec.id, platform, overrides), platform),
  );
  // 同じ打鍵に 2 つ割り当てられていたら、どちらも動かさない（勝手に選ばない）
  return hits.length === 1 ? hits[0]!.id : null;
}

/**
 * 使えない binding を除いた代替候補。
 *
 * `taken` には OS 側で既に使われているもの（登録に失敗したもの）を渡す。
 * **候補が尽きたら空を返す。**適当な組み合わせを作って薦めない。
 */
export function alternatesFor(
  id: ShortcutId,
  platform: Platform,
  taken: readonly Binding[] = [],
): readonly Binding[] {
  const isTaken = (candidate: Binding): boolean =>
    taken.some((t) => sameBinding(t, candidate)) ||
    // 他のショートカットの既定と当たるものも薦めない
    SHORTCUTS.some((s) => s.id !== id && sameBinding(s.defaults[platform], candidate));
  return shortcutSpec(id).alternates[platform].filter((candidate) => !isTaken(candidate));
}

export function sameBinding(a: Binding, b: Binding): boolean {
  return (
    a.code === b.code &&
    a.modifiers.primary === b.modifiers.primary &&
    a.modifiers.alt === b.modifiers.alt &&
    a.modifiers.shift === b.modifiers.shift &&
    a.modifiers.control === b.modifiers.control
  );
}

const CODE_LABELS: Readonly<Record<string, string>> = {
  Space: 'Space',
  Enter: 'Enter',
  Escape: 'Esc',
  Backquote: '`',
  Period: '.',
};

function codeLabel(code: string): string {
  return CODE_LABELS[code] ?? code.replace(/^Key/, '').replace(/^Digit/, '');
}

/** 人が読める表記。設定画面と、衝突を知らせるときに使う。 */
export function bindingLabel(binding: Binding, platform: Platform): string {
  const parts: string[] = [];
  if (binding.modifiers.control) parts.push('Control');
  if (binding.modifiers.alt) parts.push(platform === 'macos' ? 'Option' : 'Alt');
  if (binding.modifiers.shift) parts.push('Shift');
  if (binding.modifiers.primary) parts.push(platform === 'macos' ? 'Command' : 'Ctrl');
  parts.push(codeLabel(binding.code));
  return parts.join(' + ');
}

/**
 * IME 変換中か。**変換確定の Enter を送信にしない。**
 *
 * 日本語入力では Enter が「変換を確定する」ためのキーでもある。
 * ここを見落とすと、変換途中の文が依頼として送られる。
 */
export function isComposing(event: { isComposing?: boolean; keyCode?: number }): boolean {
  // keyCode 229 は、isComposing を出さない環境での変換中の印
  return event.isComposing === true || event.keyCode === 229;
}
