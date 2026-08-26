/**
 * 言語モデルの持ち込み。正本 §21、UI/UX §22。
 *
 * **Astra は共通の API キーを持たない。**利用者が自分の利用権を持ち込む。
 *
 *   1. Claude Code を繋いでいる → 端末の Claude Code を subprocess で呼ぶ
 *   2. 自分の API キーを登録している → そのキーで呼ぶ
 *   3. ほかの提供者を登録している → それで呼ぶ
 *   4. どれも無い → **使えないと言う**（黙って劣化しない）
 *
 * 大事な線引き:
 *
 *   - Claude Code の資格情報を**読み取らない・写さない。**
 *     Claude Code を使うなら、Claude Code 自体を実行の境界にする。
 *     ログインの中身を抜いて API へ流用すると、利用者が同意した経路から外れる
 *   - API キーは**端末の資格情報ストアに置き、サーバへ送らない**（§21）。
 *     サーバが持つのは参照だけ
 */
import { z } from 'zod';

/** 呼び方の種類。**増やすときは、選ぶ順も一緒に決める。** */
export const LANGUAGE_MODEL_KINDS = [
  'claude_code',
  'anthropic_api',
  'gemini_api',
  'openai_api',
  'local',
] as const;
export const LanguageModelKind = z.enum(LANGUAGE_MODEL_KINDS);
export type LanguageModelKind = z.infer<typeof LanguageModelKind>;

export const LANGUAGE_MODEL_LABEL: Readonly<Record<LanguageModelKind, string>> = {
  claude_code: 'Claude Code（この端末）',
  anthropic_api: 'Anthropic API（自分のキー）',
  gemini_api: 'Gemini API（自分のキー）',
  openai_api: 'OpenAI API（自分のキー）',
  local: '手元のモデル',
};

/**
 * どこに資格情報があるか。**サーバに置く選択肢を作らない。**
 *
 *   - `claude_code`: Astra は持たない。Claude Code が自分で持っている
 *   - `keychain`: 端末の資格情報ストア。サーバへは参照だけ
 */
export const CREDENTIAL_LOCATIONS = ['claude_code', 'keychain', 'none'] as const;
export const CredentialLocation = z.enum(CREDENTIAL_LOCATIONS);
export type CredentialLocation = z.infer<typeof CredentialLocation>;

export const LanguageModelOption = z.object({
  kind: LanguageModelKind,
  /** いま使える状態か。 */
  available: z.boolean(),
  /** 使えない理由。**available=false なら必ず入る。** */
  reason: z.string().nullable().default(null),
  credential: CredentialLocation,
  /** 実装の名前。版を比べるときに要る。 */
  implementation: z.string().nullable().default(null),
});
export type LanguageModelOption = z.infer<typeof LanguageModelOption>;

/**
 * 選ぶ順。**上から順に、使えるものを採る。**
 *
 * Claude Code を先にするのは、利用者が既に払っている利用権をそのまま使えるため。
 * API キーより手数が少なく、Astra がキーを預からずに済む。
 */
export const SELECTION_ORDER: readonly LanguageModelKind[] = [
  'claude_code',
  'anthropic_api',
  'gemini_api',
  'openai_api',
  'local',
];

/** どれを使うか。**使えるものが無ければ null**（勝手に劣化させない）。 */
export function selectLanguageModel(
  options: readonly LanguageModelOption[],
): LanguageModelOption | null {
  for (const kind of SELECTION_ORDER) {
    const option = options.find((o) => o.kind === kind && o.available);
    if (option) return option;
  }
  return null;
}

/**
 * 資格情報の置き場所として許されるか。
 *
 * **サーバに値を置く形を通さない。**ここが唯一の門になる。
 */
export function isAllowedCredentialLocation(
  kind: LanguageModelKind,
  location: CredentialLocation,
): boolean {
  if (kind === 'claude_code') {
    // Claude Code の資格情報は Claude Code のもの。Astra は持たない。
    return location === 'claude_code';
  }
  if (kind === 'local') return location === 'none';
  // 残りは端末の資格情報ストアだけ
  return location === 'keychain';
}

/** 何が足りなくて使えないのか。画面にそのまま出す。 */
export const UNAVAILABLE_REASON: Readonly<Record<LanguageModelKind, string>> = {
  claude_code: 'この端末に Claude Code が見つかりません。',
  anthropic_api: 'Anthropic の API キーが登録されていません。',
  gemini_api: 'Gemini の API キーが登録されていません。',
  openai_api: 'OpenAI の API キーが登録されていません。',
  local: '手元で動くモデルが入っていません。',
};

/** 1 つも無いときに出す文。**「あとで」で終わらせない。** */
export const NO_MODEL_MESSAGE =
  '言葉を扱う仕事には、モデルの接続が要ります。Claude Code を繋ぐか、お使いの API キーを登録してください。';
