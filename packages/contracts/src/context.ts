/**
 * Context Capsule と Context Lens。正本 §6.3、UI/UX §5。
 *
 * 設計の要:
 *   Context Lens には「今回の依頼で実際に使う / 使った情報」だけを出す。
 *   アクセス可能な全データの一覧ではない（UI/UX §5.2）。
 *   これを守らないと、ユーザーは「Astra が何を見たか」を確認できなくなる。
 */
import { z } from 'zod';
import { Sensitivity } from './artifact.js';

/** UI/UX §5.1 の Context categories。 */
export const ContextCategory = z.enum([
  /** foreground app / file / selected text */
  'current',
  /** Person / Account / Project */
  'entity',
  /** calendar event */
  'schedule',
  /** related mail / Drive / Library */
  'internal',
  /** Web / public sources */
  'external',
  /** sensitivity / restricted data */
  'policy',
]);
export type ContextCategory = z.infer<typeof ContextCategory>;

export const ContextSource = z.object({
  id: z.string().min(1),
  category: ContextCategory,
  /** chip に出す短いラベル。「Q4提案.pptx」「A社」「明日 10:00」 */
  label: z.string().min(1).max(80),
  /** 「Why this?」で 1 段だけ開く説明。モデル内部の推論は出さない（UI/UX §5.2）。 */
  reason: z.string().max(200).nullable().default(null),
  sensitivity: Sensitivity.default('PRIVATE'),
  /**
   * ユーザーが外せるか。外したら plan を再評価する（UI/UX §5.2）。
   * policy 由来のものなど、外せない前提の項目は false。
   */
  removable: z.boolean().default(true),
  /** 実際に参照したか。まだ候補の段階なら false。 */
  used: z.boolean().default(false),
});
export type ContextSource = z.infer<typeof ContextSource>;

/**
 * ローカルからクラウドへ渡す最小限の文脈。正本 §6.3。
 *
 * raw なローカルデータを何でも送らない。Local Context Engine が要約・抽出する。
 */
export const ContextCapsule = z.object({
  active_app: z.string().max(120).nullable().default(null),
  window_title: z.string().max(300).nullable().default(null),
  user_intent: z.string().max(2000).nullable().default(null),
  /** 「それ」「あれ」「2番」の解決先候補 */
  referents: z.array(z.string().max(200)).max(20).default([]),
  selected_text: z.string().max(4000).nullable().default(null),
  sources: z.array(ContextSource).max(50).default([]),
  /** 明示的に添付が許可された生データの参照 */
  allowed_raw_attachments: z.array(z.string()).max(20).default([]),
  /** capsule 全体の機密度。REGULATED は plugin policy が cloud 送信可否を決める。 */
  sensitivity: Sensitivity.default('PRIVATE'),
});
export type ContextCapsule = z.infer<typeof ContextCapsule>;

/** UI/UX §4.3: chip は最大 3 個 + "+N"。 */
export const CONTEXT_CHIP_LIMIT = 3;

export interface ChipDisplay {
  readonly visible: readonly ContextSource[];
  readonly overflow: number;
}

export function chipsFor(
  sources: readonly ContextSource[],
  // 既定値が `as const` のリテラル型を引き継がないよう、型を明示する
  limit: number = CONTEXT_CHIP_LIMIT,
): ChipDisplay {
  // 実際に使ったものを先に出す。候補より確定の方が確認したい情報。
  const ordered = [...sources].sort((a, b) => Number(b.used) - Number(a.used));
  return {
    visible: ordered.slice(0, limit),
    overflow: Math.max(0, ordered.length - limit),
  };
}

/**
 * cloud へ送ってよいか。正本 §6.3 の data classification。
 *
 * REGULATED は plugin policy に従う。判断材料が無いなら送らない側へ倒す。
 */
export function mayLeaveDevice(sensitivity: Sensitivity, regulatedAllowed = false): boolean {
  if (sensitivity === 'REGULATED') return regulatedAllowed;
  return true;
}
