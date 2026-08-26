/**
 * 「今日気にすべきこと」。正本 §2.1、UI/UX §8.1、Phase 6 実装仕様 §4。
 *
 * **話しかけ過ぎないための仕組み**であって、通知を増やす仕組みではない。
 * 最大 3 件しか出さず、黙っている価値（InterruptionCost）を式に入れる。
 */
import {
  BriefItem,
  MAX_ATTENTION_ITEMS,
  proactiveScore,
  type DailyBrief,
  type Severity,
  type WorldFact,
} from '@astra/contracts';

export interface TaskLike {
  readonly id: string;
  readonly title: string | null;
  readonly status: string;
  readonly updatedAt: string;
}

export interface MeetingLike {
  readonly id: string;
  readonly title: string;
  readonly startsAt: string;
}

/** 「これは出さないで」の記録。UI/UX §16。 */
export interface AttentionFeedback {
  readonly itemId: string;
  /** later: しばらく出さない / never: 二度と出さない（明示拒否）。 */
  readonly verdict: 'later' | 'never';
  readonly createdAt: string;
}

export interface BriefInput {
  readonly commitments: readonly WorldFact[];
  readonly tasks: readonly TaskLike[];
  readonly meetings: readonly MeetingLike[];
  readonly now: Date;
  /**
   * 断られたもの。**覚えない dismiss は、拒否ではなく無視。**
   * 押した直後に消えても次の brief でまた出るなら、拒否は届いていない。
   */
  readonly feedback?: readonly AttentionFeedback[];
}

const DAY_MS = 86_400_000;

/** 「あとで」がもう一度出てよくなるまで。 */
export const DISMISS_QUIET_MS = DAY_MS;

/**
 * いまこの item を出してよいか。
 *
 * `never` は期限を設けない。§16 の「明示拒否を長期尊重する」は、
 * **こちらの都合で忘れてよい、という意味ではない。**
 */
export function suppressedBy(
  feedback: AttentionFeedback | undefined,
  now: Date,
): 'never' | 'later' | null {
  if (!feedback) return null;
  if (feedback.verdict === 'never') return 'never';
  const since = now.getTime() - Date.parse(feedback.createdAt);
  return Number.isFinite(since) && since < DISMISS_QUIET_MS ? 'later' : null;
}

/** 期限までの日数。無ければ null。 */
function daysUntil(due: string | null, now: Date): number | null {
  if (!due) return null;
  const at = Date.parse(due);
  return Number.isFinite(at) ? Math.floor((at - now.getTime()) / DAY_MS) : null;
}

/**
 * 締め切りの近さを urgency に直す。
 *
 * 期限が無いものは 0 にしない（それでは絶対に出てこない）が、
 * **期限のあるものより必ず下**にする（AC6-4）。
 */
function urgencyFromDue(days: number | null): number {
  if (days === null) return 0.3;
  if (days < 0) return 1; // 過ぎている
  if (days === 0) return 0.95;
  if (days <= 1) return 0.8;
  if (days <= 3) return 0.6;
  if (days <= 7) return 0.45;
  return 0.35;
}

type Item = ReturnType<typeof BriefItem.parse>;

function commitmentItem(fact: WorldFact, now: Date): Item | null {
  // 済んだもの・やめたものは出さない（AC6-3）
  if (fact.status !== 'OPEN') return null;

  const days = daysUntil(fact.due_at, now);
  const overdue = days !== null && days < 0;
  const severity: Severity = overdue ? 'action-required' : days === 0 ? 'attention' : 'info';

  return BriefItem.parse({
    id: `commitment:${fact.id}`,
    severity,
    title: fact.statement,
    detail:
      days === null
        ? '期限は決まっていません'
        : overdue
          ? `${Math.abs(days)} 日過ぎています`
          : days === 0
            ? '今日までです'
            : `あと ${days} 日`,
    action_label: '確認する',
    target: { kind: 'commitment', fact_id: fact.id },
    score: proactiveScore({
      importance: overdue ? 0.9 : 0.7,
      urgency: urgencyFromDue(days),
      confidence: fact.confidence,
      relevance: 1,
      // 自分で決めたことなので、割り込みの重さは小さい
      interruptionCost: 0.05,
    }),
  });
}

function taskItem(task: TaskLike, now: Date): Item | null {
  if (task.status === 'WAITING_APPROVAL') {
    return BriefItem.parse({
      id: `task:${task.id}`,
      severity: 'action-required',
      title: task.title ?? '名前のない仕事',
      detail: '確認を待っています',
      action_label: '確認する',
      target: { kind: 'task', task_id: task.id },
      score: proactiveScore({
        importance: 0.9,
        urgency: 0.9,
        confidence: 1,
        relevance: 1,
        // 止まっているので、黙っているほうが害になる
        interruptionCost: 0,
      }),
    });
  }

  if (task.status === 'FAILED') {
    return BriefItem.parse({
      id: `task:${task.id}`,
      severity: 'critical',
      title: task.title ?? '名前のない仕事',
      detail: '失敗しました',
      action_label: '見る',
      target: { kind: 'task', task_id: task.id },
      score: proactiveScore({
        importance: 0.85,
        urgency: 0.8,
        confidence: 1,
        relevance: 1,
        interruptionCost: 0.05,
      }),
    });
  }

  if (task.status === 'COMPLETED') {
    const hoursAgo = (now.getTime() - Date.parse(task.updatedAt)) / 3_600_000;
    // 終わって間もないものだけ。昨日の完了を今日も出さない。
    if (!Number.isFinite(hoursAgo) || hoursAgo > 24) return null;
    return BriefItem.parse({
      id: `task:${task.id}`,
      severity: 'info',
      title: task.title ?? '名前のない仕事',
      detail: '終わりました',
      action_label: '見る',
      target: { kind: 'task', task_id: task.id },
      score: proactiveScore({
        importance: 0.5,
        urgency: 0.4,
        confidence: 1,
        relevance: 0.8,
        // 済んだ知らせ。急かす理由が無いので、黙っている価値が高い
        interruptionCost: 0.15,
      }),
    });
  }

  return null;
}

function meetingItem(meeting: MeetingLike, now: Date): Item | null {
  const minutes = (Date.parse(meeting.startsAt) - now.getTime()) / 60_000;
  if (!Number.isFinite(minutes)) return null;
  // 終わった会議と、まだ遠い会議は出さない
  if (minutes < 0 || minutes > 120) return null;

  return BriefItem.parse({
    id: `meeting:${meeting.id}`,
    severity: minutes <= 30 ? 'attention' : 'info',
    title: meeting.title,
    detail: `${Math.round(minutes)} 分後`,
    action_label: '準備する',
    target: { kind: 'meeting', meeting_id: meeting.id },
    score: proactiveScore({
      importance: 0.8,
      urgency: minutes <= 30 ? 0.95 : 0.6,
      confidence: 1,
      relevance: 1,
      interruptionCost: 0.05,
    }),
  });
}

/**
 * brief を組む。
 *
 * **スコアが 0 以下のものは出さない。**黙っていたほうがよいと
 * 式が言っているものを、順位が足りているからといって出さない（AC6-6）。
 */
export function buildBrief(input: BriefInput): DailyBrief {
  const byItem = new Map((input.feedback ?? []).map((f) => [f.itemId, f]));

  const items = [
    ...input.commitments.map((c) => commitmentItem(c, input.now)),
    ...input.tasks.map((t) => taskItem(t, input.now)),
    ...input.meetings.map((m) => meetingItem(m, input.now)),
  ]
    .filter((item): item is Item => item !== null && item.score > 0)
    // 断られたものは出さない。「すべて見る」にも出さない（§16）。
    .filter((item) => suppressedBy(byItem.get(item.id), input.now) === null);

  // 同点のときの並びを決めておく。実行ごとに順番が変わらないように。
  items.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));

  return {
    attention: items.slice(0, MAX_ATTENTION_ITEMS),
    more: items.slice(MAX_ATTENTION_ITEMS),
    generated_at: input.now.toISOString(),
  };
}
