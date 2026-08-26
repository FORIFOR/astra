/**
 * 会議のまとめ。Phase 3 実装仕様 §5、UI/UX §12.6。
 *
 * **根拠のない断定を作らない。**要点・決定・ToDo の各項目は、
 * どの segment から来たかを必ず持つ。UI/UX §12.6 の
 * 「引用番号を押すと transcript + timestamp へ跳ぶ」はこれが担保する。
 *
 * 要約の質そのものは LanguageModel の仕事（OQ-11 が決まるまで代役）。
 * ここが持つのは「引用を落とさない」という、モデルに任せてはいけない性質。
 */
import type { MeetingActionItem, MeetingClaim, MeetingSegment } from '@astra/contracts';

export interface MeetingSummarizer {
  summarize(segments: readonly MeetingSegment[]): Promise<SummaryDraft>;
  readonly isStandIn: boolean;
}

/** モデルが返すもの。引用は **segment id** で受け、本文は後から引かない。 */
export interface SummaryDraft {
  readonly summary: readonly { text: string; segmentIds: readonly string[] }[];
  readonly decisions: readonly { text: string; segmentIds: readonly string[] }[];
  readonly actionItems: readonly {
    text: string;
    segmentIds: readonly string[];
    assignee?: string | null;
    due?: string | null;
  }[];
  readonly openQuestions: readonly { text: string; segmentIds: readonly string[] }[];
}

/**
 * 下書きを契約の形へ落とす。
 *
 * **存在しない segment を指す引用は捨てる。**モデルが id を作り話しても、
 * 跳べない引用を UI に出さない。引用が 1 つも残らない項目は項目ごと落とす。
 */
export function withCitations(
  draft: SummaryDraft,
  segments: readonly MeetingSegment[],
): {
  summary: MeetingClaim[];
  decisions: MeetingClaim[];
  actionItems: MeetingActionItem[];
  openQuestions: MeetingClaim[];
  dropped: number;
} {
  const byId = new Map(segments.map((s) => [String(s.id), s]));
  let dropped = 0;

  const claim = (item: { text: string; segmentIds: readonly string[] }): MeetingClaim | null => {
    const citations = item.segmentIds
      .map((id) => byId.get(id))
      .filter((s): s is MeetingSegment => s !== undefined)
      .map((s) => ({ segment_id: s.id, start_ms: s.start_ms }));
    if (citations.length === 0) {
      dropped += 1;
      return null;
    }
    return { text: item.text, citations };
  };

  const claims = (items: readonly { text: string; segmentIds: readonly string[] }[]) =>
    items.map(claim).filter((c): c is MeetingClaim => c !== null);

  return {
    summary: claims(draft.summary),
    decisions: claims(draft.decisions),
    actionItems: draft.actionItems
      .map((item) => {
        const base = claim(item);
        if (!base) return null;
        return {
          ...base,
          assignee: item.assignee ?? null,
          due: item.due ?? null,
        } satisfies MeetingActionItem;
      })
      .filter((c): c is MeetingActionItem => c !== null),
    openQuestions: claims(draft.openQuestions),
    dropped,
  };
}

/** 会議に出てきた話者の数。名前が付いていなくても数える。 */
export function speakerCount(segments: readonly MeetingSegment[]): number {
  return new Set(segments.map((s) => s.speaker_tag).filter((t) => t !== null)).size;
}

export function durationMs(segments: readonly MeetingSegment[]): number {
  return segments.reduce((max, s) => Math.max(max, s.end_ms), 0);
}

/**
 * モデル無しのまとめ役。OQ-11 が決まるまでの代役。
 *
 * 賢いふりをせず、**決まった手掛かり語**で拾う。誤ってでも要約するより、
 * 拾えないほうがまだ害が少ない。
 */
export class KeywordSummarizer implements MeetingSummarizer {
  readonly isStandIn = true;

  async summarize(segments: readonly MeetingSegment[]): Promise<SummaryDraft> {
    const pick = (patterns: readonly RegExp[]) =>
      segments
        .filter((s) => patterns.some((p) => p.test(s.text)))
        .map((s) => ({ text: s.text, segmentIds: [String(s.id)] }));

    return {
      // 要点は「長く喋られたところ」。短い相槌を要点にしない。
      summary: [...segments]
        .sort((a, b) => b.end_ms - b.start_ms - (a.end_ms - a.start_ms))
        .slice(0, 3)
        .map((s) => ({ text: s.text, segmentIds: [String(s.id)] })),
      decisions: pick([/決定/, /で行き(ます|ましょう)/, /合意/, /決ま(り|る)/]),
      actionItems: pick([/します/, /送(り|る)/, /対応/, /やり(ます|ましょう)/]).map((item) => ({
        ...item,
        assignee: null,
        due: null,
      })),
      openQuestions: pick([/\?$/, /？$/, /検討/, /未定/]),
    };
  }
}
