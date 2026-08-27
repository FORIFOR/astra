/**
 * 外から来る能力と、いま代役かどうか。正本 §21・§25。
 *
 * **代役であることを、名乗らせる。**
 * 「まだ繋いでいない」ことを人の記憶や README に置くと、
 * いつの間にか「動いているつもり」になる。
 *
 * ここに列挙されたものは、起動時に必ず「本物か代役か」を答える。
 * 答えないものがあれば試験が落ちる（**黙って抜けられない**）。
 */
import { z } from 'zod';

/**
 * 外部提供者が要る能力。**製品が要求するもの**を並べる。
 * 実装が追い付いていない行を、ここから消して辻褄を合わせない。
 */
export const EXTERNAL_CAPABILITIES = [
  // 正本 §8（Research）
  'search',
  'language_model',
  // 正本 §11（Meeting STT）
  'speech_to_text',
  'translation',
  // 正本 §15.1・§15.2
  'image_generation',
  'video_generation',
  // 正本 §2.4（Connector）
  'oauth_providers',
  // 正本 §27（DeepNote から引き継ぐ TTS）。**製品の必須ではない**
  'text_to_speech',
] as const;

export const ExternalCapability = z.enum(EXTERNAL_CAPABILITIES);
export type ExternalCapability = z.infer<typeof ExternalCapability>;

export const CAPABILITY_LABEL: Readonly<Record<ExternalCapability, string>> = {
  search: '検索',
  language_model: '言語モデル',
  speech_to_text: '文字起こし',
  translation: '翻訳',
  image_generation: '画像の生成',
  video_generation: '動画の生成',
  oauth_providers: '外部サービスへの接続',
  text_to_speech: '読み上げ',
};

/**
 * 本番で必須の能力。**ここに無いものは、無くても起動してよい。**
 *
 * 分けてある理由: 読み上げが無くても Astra は使える（文字で読める）。
 * 必須と任意を混ぜると、任意のものが 1 つ欠けただけで本番が上がらなくなり、
 * やがて「とりあえず必須から外す」が始まる。
 */
export const REQUIRED_CAPABILITIES: readonly ExternalCapability[] = [
  'search',
  'language_model',
  'speech_to_text',
  'translation',
  'oauth_providers',
];

/** 任意。欠けていても本番は起動する（できないことは申告する）。 */
export function isRequiredCapability(capability: ExternalCapability): boolean {
  return REQUIRED_CAPABILITIES.includes(capability);
}

/**
 * どこまで確かめたか。**「動くはず」と「動いた」を分ける。**
 *
 *   `verified`       … 実際の提供者に繋いで、この目で結果を見た
 *   `unverified`     … 実装はある。設定もある。**まだ実物で確かめていない**
 *   `not_configured` … 設定されていない。呼べば「繋がっていない」と答える
 *
 * 分けるのは、`unverified` を `verified` として報告しないため。
 * 混ぜると、受け入れの記録が「たぶん動く」の集まりになる。
 */
export const VERIFICATION_STATES = ['verified', 'unverified', 'not_configured'] as const;
export const VerificationState = z.enum(VERIFICATION_STATES);
export type VerificationState = z.infer<typeof VerificationState>;

export const CapabilityStatus = z.object({
  capability: ExternalCapability,
  /** いま使っている実装の名前。 */
  implementation: z.string(),
  /** 代役か。**分からないときは true に倒す。** */
  isStandIn: z.boolean(),
  /** 何を設定すれば本物になるか。代役のときは必ず書く。 */
  configureWith: z.string().nullable().default(null),
  /**
   * どこまで確かめたか。
   *
   * **既定は `unverified`。**確かめた記録がある能力だけが `verified` を名乗る。
   * 既定を `verified` にすると、書いた人が忘れただけのものが
   * 「確認済み」として報告に載る。
   */
  verification: VerificationState.default('unverified'),
});
export type CapabilityStatus = z.infer<typeof CapabilityStatus>;

export const CapabilityReport = z.object({
  items: z.array(CapabilityStatus),
});
export type CapabilityReport = z.infer<typeof CapabilityReport>;

/** 代役のまま残っているもの。空なら全部本物。 */
export function remainingStandIns(report: CapabilityReport): CapabilityStatus[] {
  return report.items.filter((item) => item.isStandIn);
}

/**
 * 本物だが、まだ実物で確かめていないもの。
 *
 * **代役とは別に数える。**代役は「動かない」、これは「動くはずだが
 * 見ていない」。受け入れの報告で両者を混ぜると、
 * どちらの意味でも読めてしまう。
 */
export function unverifiedCapabilities(report: CapabilityReport): CapabilityStatus[] {
  return report.items.filter((item) => !item.isStandIn && item.verification === 'unverified');
}

/**
 * 代役のまま本番へ出さない。
 *
 * 本番では止める。それ以外では警告を返す。
 * **黙って通さない。**通すと、代役のまま本番が動く。
 */
export function assertNoStandIns(
  report: CapabilityReport,
  env: string,
): { warn: string | null; remaining: readonly CapabilityStatus[] } {
  const remaining = remainingStandIns(report);
  if (remaining.length === 0) return { warn: null, remaining };

  const list = remaining
    .map((item) => `${CAPABILITY_LABEL[item.capability]} (${item.implementation})`)
    .join(', ');

  if (env === 'production') {
    /*
     * **必須だけで止める。**任意のものまで止めると、
     * 1 つ欠けただけで本番が上がらなくなり、
     * やがて「とりあえず必須から外す」が始まる。
     */
    const blocking = remaining.filter((item) => isRequiredCapability(item.capability));
    if (blocking.length > 0) {
      const how = blocking
        .map((item) => item.configureWith)
        .filter((v): v is string => v !== null)
        .join(', ');
      const names = blocking
        .map((item) => `${CAPABILITY_LABEL[item.capability]} (${item.implementation})`)
        .join(', ');
      throw new Error(
        `these required capabilities are still stand-ins: ${names}. Configure them first${how ? ` (${how})` : ''}.`,
      );
    }
  }
  return { warn: `running with stand-ins: ${list}`, remaining };
}

/**
 * 報告が能力を過不足なく覆っているか。
 *
 * **列挙から漏れたものは、代役かどうかも分からない。**
 * 分からないものを「本物」として扱わないために、ここで落とす。
 */
export function missingFromReport(report: CapabilityReport): ExternalCapability[] {
  const covered = new Set(report.items.map((item) => item.capability));
  return EXTERNAL_CAPABILITIES.filter((capability) => !covered.has(capability));
}

/** 1 つの能力についての、呼び出し側が知っていること。 */
export interface CapabilityInput {
  /** いま使っている実装の名前。無ければ 'none'。 */
  readonly implementation: string;
  readonly isStandIn: boolean;
  /** 何を設定すれば本物になるか。 */
  readonly configureWith: string | null;
  /**
   * 実物で確かめたか。**省略すると `unverified`。**
   *
   * 既定を「確認済み」にしない。書いた人が忘れただけのものが
   * 「確認済み」として報告に載るのを避ける。
   */
  readonly verification?: VerificationState;
}

/**
 * 報告を組む。**能力を 1 つでも省けない**（型が要求する）。
 *
 * 省けるようにすると、実装していないものが報告から消えて、
 * 「全部本物」に見える。いちばん避けたい壊れ方はそれ。
 */
export function buildCapabilityReport(
  inputs: Readonly<Record<ExternalCapability, CapabilityInput>>,
): CapabilityReport {
  return {
    items: EXTERNAL_CAPABILITIES.map((capability) => ({
      capability,
      implementation: inputs[capability].implementation,
      isStandIn: inputs[capability].isStandIn,
      configureWith: inputs[capability].configureWith,
      verification:
        inputs[capability].verification ??
        // 代役は確かめようが無い。設定されていない、と答える。
        (inputs[capability].isStandIn ? 'not_configured' : 'unverified'),
    })),
  };
}

/** 実装がまだ無いもの。代役ですらない。 */
export const NOT_IMPLEMENTED = (configureWith: string): CapabilityInput => ({
  implementation: 'none',
  // 無いものを「本物」にしない
  isStandIn: true,
  configureWith,
  verification: 'not_configured',
});
