/**
 * LLM への Context Injection。**全データを毎回渡さない。**
 *
 *   query → 意図（仕事の優先を聞いているか）→ Work Graph から関連する分だけ → 上限つき → LLM
 *
 * 関連しない質問（「この画像のエラーコードは？」）には 0 件。「今日何を優先？」には上位 3 件まで。
 */
import {
  MAX_INJECTED_PRIORITIES,
  renderWorkContext,
  type InjectedPriority,
  type PersonalizationProfile,
  type WorkContext,
} from '@astra/contracts';
import { titleTokens } from './graph.js';

/**
 * 仕事の状況を聞いている問いか。**命令（「会議を録音して」）は含めない** — それに案件を添えても役に立たない。
 * 「今日何を優先」「今週やばいのは」「返信待ちは」「この会議で何を聞く」のような問いだけ。
 */
const WORK_INTENT =
  /(優先|やばい|忙し|何をす|何から|どれから|何が残|抱えて|締め?切り|期限|返信待ち|待ってい|返さな|今日.*(予定|やる|すべき|何)|今週.*(やる|予定|何)|会議.*(聞く|質問|準備|備え)|priorit|what should|what.*focus|this week|deadline|waiting on|overdue)/i;

export interface InjectionInput {
  readonly question: string;
  readonly context: WorkContext;
  readonly profile?: PersonalizationProfile | null;
}

export function selectInjection(input: InjectionInput): InjectedPriority[] {
  const { context, question } = input;
  if (!context.inference_enabled) return [];
  if (input.profile && !input.profile.inference_enabled) return [];
  const q = titleTokens(question);
  const generic = WORK_INTENT.test(question);
  const scored = context.priorities.map((p) => {
    // 名指しは案件名だけで判定する（状況の行「今日 会議」で「会議を録音して」に当てない）。
    const hay = titleTokens(p.project).filter((h) => h.length >= 2);
    const overlap = q.filter((w) =>
      hay.some((h) => h === w || w.includes(h) || (w.length >= 3 && h.includes(w))),
    ).length;
    return { p, relevance: overlap > 0 ? 1 : generic ? 0.5 : 0 };
  });
  return scored
    .filter((s) => s.relevance > 0)
    .sort(
      (a, b) => b.relevance - a.relevance || b.p.score - a.p.score || a.p.id.localeCompare(b.p.id),
    )
    .slice(0, MAX_INJECTED_PRIORITIES)
    .map(({ p }) => ({ project: p.project, score: p.score, lines: p.lines.slice(0, 3) }));
}

/** 質問に添える文字列。空なら何も添えない。 */
export function injectionText(input: InjectionInput): string {
  return renderWorkContext(selectInjection(input));
}
