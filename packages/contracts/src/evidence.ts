/**
 * Evidence Ledger。UI/UX §15、正本 §8.1。
 *
 * §15 は **Progressive Disclosure** を要求している:
 *
 *   L0  source count + confidence + contradiction count
 *   L1  source groups + key claims
 *   L2  claim ↔ source relation / supports / contradicts
 *   L3  source detail / timestamp / original location
 *
 * **常時前面に出さない。**結論の信頼ラベルから、必要なときに掘る。
 * DB には全部あるのに読み出す口が無いと、
 * 「根拠が無い」のか「見せていないだけ」なのかを利用者が言えなくなる。
 */
import { z } from 'zod';
import { TaskId } from './ids.js';
import { Timestamp } from './primitives.js';

export const SOURCE_TYPES = ['official', 'filing', 'news', 'internal', 'other'] as const;
export const SourceType = z.enum(SOURCE_TYPES);
export type SourceType = z.infer<typeof SourceType>;

export const Confidence = z.enum(['low', 'medium', 'high']);
export type Confidence = z.infer<typeof Confidence>;

/** L2 / L3。1 件の根拠。 */
export const EvidenceItem = z.object({
  id: z.uuid(),
  claim: z.string(),
  /** L3: 原文の場所。 */
  source_url: z.string(),
  source_type: SourceType,
  publisher: z.string().nullable(),
  /**
   * L3: 見つけたときの見出しと抜粋。
   *
   * **URL だけでは、リンクが切れた時点で確かめられなくなる。**
   * 台帳を見る人が、開き直さずに文脈を掴めるようにする。
   */
  title: z.string().nullable().default(null),
  snippet: z.string().nullable().default(null),
  /**
   * どの検索が見つけたか。
   *
   * 提供者を替えたとき、**どれが古い提供者のものか**を見分ける。
   * 質の比較も、片方だけの取り消しも、これが無いとできない。
   */
  provider: z.string().nullable().default(null),
  /** L3: いつ書かれたか / いつ取ってきたか。**片方だけでは古さを判断できない。** */
  published_at: Timestamp.nullable(),
  retrieved_at: Timestamp,
  quality_score: z.number().min(0).max(1),
  freshness_score: z.number().min(0).max(1),
  /** L2: 同じ主張を支えるもの / 食い違うもの。 */
  supports: z.array(z.uuid()).default([]),
  contradicts: z.array(z.uuid()).default([]),
});
export type EvidenceItem = z.infer<typeof EvidenceItem>;

/** L1。出典の種類ごとの数。 */
export const SourceGroup = z.object({
  source_type: SourceType,
  count: z.number().int().nonnegative(),
});
export type SourceGroup = z.infer<typeof SourceGroup>;

export const EvidenceLedger = z.object({
  task_id: TaskId,
  question: z.string(),
  // ---- L0
  /** **同じ URL は 1 つと数える。**同じページを 3 回引いて「3 sources」にしない。 */
  source_count: z.number().int().nonnegative(),
  confidence: Confidence,
  contradiction_count: z.number().int().nonnegative(),
  // ---- L1
  groups: z.array(SourceGroup).default([]),
  /** 重みの大きい主張。**結論そのものではない**ので、そう分かる名前にしてある。 */
  key_claims: z.array(z.string()).default([]),
  // ---- L2 / L3
  items: z.array(EvidenceItem).default([]),
});
export type EvidenceLedger = z.infer<typeof EvidenceLedger>;

/**
 * 食い違いの「組」の数。
 *
 * **片側ずつ数えない。**A が B と食い違うとき行は 2 つになるので、
 * 行数を数えると 1 件の食い違いが 2 件に見える。
 * 半分にするのも間違い（A が B と C の両方と食い違い、
 * かつ B と C も食い違う場合、行は 3・組は 3）。
 */
export function countContradictionPairs(
  rows: readonly { id: string; contradicts: readonly string[] }[],
): number {
  const known = new Set(rows.map((row) => row.id));
  const seen = new Set<string>();
  for (const row of rows) {
    for (const otherId of row.contradicts) {
      // 相手が同じ台帳に居ないものは数えない（片側だけでは組にならない）
      if (!known.has(otherId)) continue;
      seen.add([row.id, otherId].sort().join(':'));
    }
  }
  return seen.size;
}

/** §15 の開示段階。UI はこの順にしか深くしない。 */
export const EVIDENCE_LEVELS = ['L0', 'L1', 'L2', 'L3'] as const;
export type EvidenceLevel = (typeof EVIDENCE_LEVELS)[number];

/**
 * 食い違っている組。L2 の表示に使う。
 *
 * 片方だけを採って消さない（正本 §8.1）。**両方見せる。**
 */
export function contradictionPairs(
  ledger: EvidenceLedger,
): { left: EvidenceItem; right: EvidenceItem }[] {
  const byId = new Map(ledger.items.map((item) => [item.id, item]));
  const seen = new Set<string>();
  const pairs: { left: EvidenceItem; right: EvidenceItem }[] = [];

  for (const item of ledger.items) {
    for (const otherId of item.contradicts) {
      const other = byId.get(otherId);
      if (!other) continue;
      // 同じ組を 2 回出さない
      const key = [item.id, other.id].sort().join(':');
      if (seen.has(key)) continue;
      seen.add(key);
      pairs.push({ left: item, right: other });
    }
  }
  return pairs;
}

/** L1 の表示文。§15 の「12 sources · High confidence · 1 contradiction」。 */
export function ledgerHeadline(ledger: EvidenceLedger): string {
  const confidence = { low: '確かさ 低', medium: '確かさ 中', high: '確かさ 高' }[
    ledger.confidence
  ];
  const parts = [`出典 ${ledger.source_count} 件`, confidence];
  // 0 件でも「食い違い 0」と出す。**出さないと、見ていないのか無いのか分からない。**
  parts.push(`食い違い ${ledger.contradiction_count} 件`);
  return parts.join(' · ');
}
