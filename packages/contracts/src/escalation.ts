/**
 * Tool が落ちたときの登り方。正本 §9.3・§24。
 *
 * ```text
 * API connector fail
 * → retry
 * → alternate connector
 * → browser structured automation
 * → screen automation
 * → user handoff
 * ```
 *
 * **段を飛ばしたことを黙らない。**
 * ブラウザ操作を持っていないなら、持っていないと言う。
 * 黙って user handoff まで落ちると、利用者には
 * 「なぜ手でやらされるのか」が分からない。
 * 「試したが駄目だった」と「試せる手段が無かった」は、別のことである。
 *
 * ここは**登り方の定義だけ**を持つ。実際に登れるかは実行側が答える。
 */
import { z } from 'zod';

export const ESCALATION_RUNGS = [
  'retry',
  'alternate_connector',
  'browser_automation',
  'screen_automation',
  'user_handoff',
] as const;

export const EscalationRung = z.enum(ESCALATION_RUNGS);
export type EscalationRung = z.infer<typeof EscalationRung>;

/** 各段が何をするか。利用者に見せる言葉。 */
export const RUNG_LABEL: Readonly<Record<EscalationRung, string>> = {
  retry: 'もう一度試す',
  alternate_connector: '別の経路で試す',
  browser_automation: 'ブラウザを操作して試す',
  screen_automation: '画面を操作して試す',
  user_handoff: '人にお願いする',
};

/** 段ごとの結末。**「試していない」と「試して駄目だった」を分ける。** */
export const RUNG_OUTCOMES = ['succeeded', 'failed', 'unavailable', 'not_reached'] as const;
export const RungOutcome = z.enum(RUNG_OUTCOMES);
export type RungOutcome = z.infer<typeof RungOutcome>;

export const EscalationStep = z.object({
  rung: EscalationRung,
  outcome: RungOutcome,
  /** unavailable のときだけ、なぜ使えないかを書く。 */
  reason: z.string().nullable().default(null),
});
export type EscalationStep = z.infer<typeof EscalationStep>;

export const EscalationTrail = z.object({
  steps: z.array(EscalationStep).default([]),
});
export type EscalationTrail = z.infer<typeof EscalationTrail>;

/** この段より下（先に試すべきもの）。順序を各所で書き直さない。 */
export function rungsBefore(rung: EscalationRung): readonly EscalationRung[] {
  return ESCALATION_RUNGS.slice(0, ESCALATION_RUNGS.indexOf(rung));
}

/**
 * 人にお願いするときの説明。
 *
 * **何を試して、何が使えなかったかを言う。**
 * 「できませんでした」だけでは、利用者は次に何をすればよいか分からない。
 */
export function handoffExplanation(trail: EscalationTrail): string {
  const tried = trail.steps.filter((s) => s.outcome === 'failed').map((s) => RUNG_LABEL[s.rung]);
  const missing = trail.steps.filter((s) => s.outcome === 'unavailable');

  const parts: string[] = [];
  if (tried.length > 0) parts.push(`${tried.join('・')}まで試しました。`);
  if (missing.length > 0) {
    parts.push(
      // 使えなかったものは、名前と理由の両方を出す
      missing
        .map((s) => `${RUNG_LABEL[s.rung]}は使えません（${s.reason ?? '理由不明'}）。`)
        .join(''),
    );
  }
  if (parts.length === 0) parts.push('試せる手段がありませんでした。');
  return parts.join('');
}

/**
 * 登った跡から、次にすべきことを決める。
 *
 * **成功した段より上を「試した」と言わない。**
 */
export function reachedHandoff(trail: EscalationTrail): boolean {
  return trail.steps.some((s) => s.rung === 'user_handoff');
}
