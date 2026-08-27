/**
 * 会議の要約を、端末で作る。正本 §12・§21、UI/UX §22。
 *
 * ほかと同じ理由で端末に置く。**Astra は共通の API キーを持たない。**
 * 会議の中身は、その会議に出た人のもので、Astra が預かる利用権で
 * 処理してよいものではない。利用者が持ち込んだ利用権で処理する。
 *
 * ここが守ること:
 *   - **引用は segment id で受ける。**本文を作り直させない
 *   - 存在しない id を指す項目は、上の `withCitations` が捨てる
 */
import type { MeetingSegment } from '@astra/contracts';
import type { MeetingSummarizer, SummaryDraft } from './summarize.js';

/** 端末への受け渡し口。`HostStepExecutor` がこれを満たす。 */
export interface HostCall {
  execute(
    input: { taskId: string; tenantId: string; userId: string },
    step: { index: number; toolId: string; args: Record<string, unknown>; requestKey: string },
  ): Promise<{ result: unknown }>;
}

export interface HostSummarizerContext {
  readonly taskId: string;
  readonly tenantId: string;
  readonly userId: string;
  readonly stepIndex: number;
}

export interface HostSummarizerDeps {
  readonly host: HostCall;
  readonly context: () => HostSummarizerContext | null;
  /** 呼び出しの鍵を作るもの。中身が同じなら結果を使い回す。 */
  readonly keyOf: (value: unknown) => Promise<string>;
}

export class HostMeetingSummarizer implements MeetingSummarizer {
  /** 代役ではない。**本物のモデルを、端末で呼んでいる。** */
  readonly isStandIn = false;
  readonly #deps: HostSummarizerDeps;

  constructor(deps: HostSummarizerDeps) {
    this.#deps = deps;
  }

  async summarize(segments: readonly MeetingSegment[]): Promise<SummaryDraft> {
    const empty: SummaryDraft = {
      summary: [],
      decisions: [],
      actionItems: [],
      openQuestions: [],
    };
    if (segments.length === 0) return empty;

    const context = this.#deps.context();
    // 仕事の外から呼ばれた。代役で答えない。
    if (context === null) throw new Error('a meeting summary needs a task to belong to');

    const args = {
      segments: segments.map((s) => ({
        id: String(s.id),
        /*
         * 誰が話したか。**出所を先に出す**（正本 §11.3）。
         * 「Speaker 1」だけを渡すと、モデルには自分か相手かが分からない。
         */
        speaker: speakerOf(s),
        text: s.text,
      })),
    };

    const { result } = await this.#deps.host.execute(
      { taskId: context.taskId, tenantId: context.tenantId, userId: context.userId },
      {
        index: context.stepIndex,
        toolId: 'llm.summarize_meeting',
        args,
        requestKey: await this.#deps.keyOf({ toolId: 'llm.summarize_meeting', args }),
      },
    );

    const raw = result as Record<string, unknown> | null;
    return {
      summary: claims(raw?.['summary']),
      decisions: claims(raw?.['decisions']),
      actionItems: actions(raw?.['action_items'] ?? raw?.['actionItems']),
      openQuestions: claims(raw?.['open_questions'] ?? raw?.['openQuestions']),
    };
  }
}

/**
 * 誰の発言かを、渡せる形で書く。
 *
 * **出所が一次情報。**分離の番号しか無いときは番号だけを言い、
 * 分からないときは「不明」と言う。**推測で埋めない。**
 */
function speakerOf(segment: MeetingSegment): string {
  const side =
    segment.source === 'microphone' ? '自分' : segment.source === 'system' ? '相手' : null;
  const tag = segment.speaker_tag === null ? null : `話者${String(segment.speaker_tag)}`;
  if (side && tag) return `${side}（${tag}）`;
  return side ?? tag ?? '不明';
}

/** 形の合わないものは捨てる。**空の項目を作らない。** */
function claims(value: unknown): { text: string; segmentIds: string[] }[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => ({
      text: text(item, 'text'),
      segmentIds: ids(item),
    }))
    .filter((item) => item.text.length > 0);
}

function actions(
  value: unknown,
): { text: string; segmentIds: string[]; assignee: string | null; due: string | null }[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => ({
      text: text(item, 'text'),
      segmentIds: ids(item),
      // **決まっていない担当や期日を、埋めない。**
      assignee: text(item, 'assignee') || null,
      due: text(item, 'due') || null,
    }))
    .filter((item) => item.text.length > 0);
}

function text(item: unknown, key: string): string {
  const value = (item as Record<string, unknown> | null)?.[key];
  return typeof value === 'string' ? value.trim() : '';
}

function ids(item: unknown): string[] {
  const value =
    (item as Record<string, unknown> | null)?.['segment_ids'] ??
    (item as Record<string, unknown> | null)?.['segmentIds'];
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === 'string');
}
