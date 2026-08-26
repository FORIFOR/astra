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
};

export const CapabilityStatus = z.object({
  capability: ExternalCapability,
  /** いま使っている実装の名前。 */
  implementation: z.string(),
  /** 代役か。**分からないときは true に倒す。** */
  isStandIn: z.boolean(),
  /** 何を設定すれば本物になるか。代役のときは必ず書く。 */
  configureWith: z.string().nullable().default(null),
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
    const how = remaining
      .map((item) => item.configureWith)
      .filter((v): v is string => v !== null)
      .join(', ');
    throw new Error(
      `these capabilities are still stand-ins: ${list}. Configure them first${how ? ` (${how})` : ''}.`,
    );
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
    })),
  };
}

/** 実装がまだ無いもの。代役ですらない。 */
export const NOT_IMPLEMENTED = (configureWith: string): CapabilityInput => ({
  implementation: 'none',
  // 無いものを「本物」にしない
  isStandIn: true,
  configureWith,
});
