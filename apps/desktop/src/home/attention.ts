/**
 * Home の Attention。正本 §2.1、UI/UX §8・§16。
 *
 *   ProactiveScore = Importance × Urgency × Confidence × UserRelevance - InterruptionCost
 *
 * **AI が勝手に話しかけ過ぎない**ための仕組み。最大 3 件しか出さず、
 * 4 件目以降は「すべて見る」へ送る（§8.1）。
 */
import type { TaskView } from '@astra/api-client';
import type { DailyBrief } from '@astra/contracts';

/** UI/UX §16 の Severity。出す面が違う。 */
export type Severity = 'info' | 'attention' | 'action-required' | 'critical';

export interface AttentionItem {
  readonly id: string;
  readonly severity: Severity;
  readonly title: string;
  readonly detail: string | null;
  /** 主ボタンの文言。何をするかを書く（§14.1 と同じ考え方）。 */
  readonly actionLabel: string;
  readonly taskId: string;
  readonly score: number;
}

interface Signals {
  readonly importance: number;
  readonly urgency: number;
  readonly confidence: number;
  readonly relevance: number;
  /** 割り込みの重さ。静かにしておく価値をここで表す。 */
  readonly interruptionCost: number;
}

export function proactiveScore(signals: Signals): number {
  return (
    signals.importance * signals.urgency * signals.confidence * signals.relevance -
    signals.interruptionCost
  );
}

/** §8.1: Attention は最大 3 件。 */
export const ATTENTION_LIMIT = 3;

const SEVERITY_RANK: Record<Severity, number> = {
  critical: 3,
  'action-required': 2,
  attention: 1,
  info: 0,
};

/** 「長時間かかった仕事が終わった」とみなす下限（§8.1）。 */
export const LONG_TASK_MS = 30_000;

function signalsFor(task: TaskView, now: number): Signals | null {
  const age = task.updated_at ? now - new Date(task.updated_at).getTime() : 0;
  // 一日以上前のものは Home に出さない。古い通知は雑音でしかない。
  const freshness = age > 24 * 60 * 60 * 1000 ? 0 : 1;
  if (freshness === 0) return null;

  switch (task.status) {
    case 'WAITING_APPROVAL':
      // ユーザーが動かないと止まったままなので、最優先
      return { importance: 1, urgency: 1, confidence: 1, relevance: 1, interruptionCost: 0.1 };
    case 'FAILED':
      return { importance: 0.9, urgency: 0.7, confidence: 1, relevance: 1, interruptionCost: 0.2 };
    case 'COMPLETED': {
      const elapsed =
        task.completed_at && task.started_at
          ? new Date(task.completed_at).getTime() - new Date(task.started_at).getTime()
          : 0;
      // 短い仕事の完了までいちいち知らせない（§8.1 は「完了した長時間 Task」を挙げている）
      if (elapsed < LONG_TASK_MS) return null;
      return { importance: 0.6, urgency: 0.3, confidence: 1, relevance: 1, interruptionCost: 0.2 };
    }
    default:
      return null;
  }
}

function severityFor(task: TaskView): Severity {
  switch (task.status) {
    case 'WAITING_APPROVAL':
      return 'action-required';
    case 'FAILED':
      return 'attention';
    default:
      return 'info';
  }
}

function describe(task: TaskView): { title: string; detail: string | null; action: string } {
  const title = task.title ?? '名前のない仕事';
  switch (task.status) {
    case 'WAITING_APPROVAL':
      return { title, detail: '確認を待っています', action: '確認する' };
    case 'FAILED':
      return { title, detail: '完了できませんでした', action: '見る' };
    default:
      return { title, detail: '完了しました', action: '見る' };
  }
}

export interface AttentionFeed {
  readonly items: readonly AttentionItem[];
  /** 4 件目以降。「すべて見る」の件数（§8.1）。 */
  readonly overflow: number;
}

/**
 * Attention を組み立てる。**出さない判断も含めてここでやる。**
 * 画面側に「これは出すべきか」を散らすと、静けさの基準がぶれる。
 */
export function buildAttentionFeed(
  tasks: readonly TaskView[],
  now: number = Date.now(),
): AttentionFeed {
  const scored: AttentionItem[] = [];

  for (const task of tasks) {
    const signals = signalsFor(task, now);
    if (!signals) continue;
    const text = describe(task);
    scored.push({
      id: `task:${task.id}`,
      severity: severityFor(task),
      title: text.title,
      detail: text.detail,
      actionLabel: text.action,
      taskId: task.id,
      score: proactiveScore(signals),
    });
  }

  scored.sort((a, b) => {
    // 深刻さが先。同じなら score。
    const bySeverity = SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity];
    return bySeverity !== 0 ? bySeverity : b.score - a.score;
  });

  return {
    items: scored.slice(0, ATTENTION_LIMIT),
    overflow: Math.max(0, scored.length - ATTENTION_LIMIT),
  };
}

/** 時刻から挨拶を選ぶ（UI/UX §8 の "Good morning"）。 */
export function greeting(hour: number): string {
  if (hour < 5) return 'こんばんは';
  if (hour < 11) return 'おはようございます';
  if (hour < 18) return 'こんにちは';
  return 'こんばんは';
}

/**
 * server が組んだ brief を、画面が扱う形へ落とす。
 *
 * **client 側で組み直さない。**commitment も会議も client は持っていないので、
 * ここで作り直すと task しか見えない feed に戻る（Phase 6 §4）。
 */
export function feedFromBrief(brief: DailyBrief): AttentionFeed {
  return {
    items: brief.attention.map((item) => ({
      id: item.id,
      severity: item.severity,
      title: item.title,
      detail: item.detail,
      actionLabel: item.action_label,
      // task 以外（commitment / 会議）は、押しても task へは飛ばない
      taskId: item.target.kind === 'task' ? item.target.task_id : '',
      score: item.score,
    })),
    overflow: brief.more.length,
  };
}
