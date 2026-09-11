/**
 * Work Pressure Score。**数学で出す。LLM は関わらない。**
 *
 *   Pressure = w1·DeadlineUrgency + w2·UnansweredRequest + w3·CalendarDensity
 *            + w4·DependencyBlock + w5·Recency + w6·Repetition + w7·ExplicitPriority
 *
 * 同じ入力からは必ず同じ出力（決定的）。同点は id で並べる。要因ごとに人が読める理由を持つので、
 * 「Astra がなんとなく忙しそうだと思った」ではなく「期限・滞留・会議密度・依存から算出した」と言える。
 */
import type { WorkPressureFactor, WorkPressureFactorName } from '@astra/contracts';

export const WEIGHTS: Readonly<Record<WorkPressureFactorName, number>> = {
  deadline: 0.3,
  unanswered: 0.2,
  calendar: 0.12,
  dependency: 0.13,
  recency: 0.1,
  repetition: 0.08,
  explicit: 0.07,
};

/** DeadlineUrgency = exp(-days_until_due / τ)。τ = 3 日。 */
export const DEADLINE_TAU_DAYS = 3;
export const UNANSWERED_HOURS_FULL = 48;

export interface PressureInput {
  readonly id: string;
  /** 期限までの日数（負 = 過ぎている）。無ければ null。 */
  readonly daysUntilDue: number | null;
  /** 自分宛の依頼が未返信のまま何時間か。無ければ null。 */
  readonly unansweredHours: number | null;
  /** 相手が再送してきたか。 */
  readonly resent: boolean;
  /** 今日の関連する会議の数と、最短の間隔（分）。 */
  readonly meetingsToday: number;
  readonly minGapMinutes: number | null;
  readonly hasPrepTask: boolean;
  /** 誰かを待っている（依存で止まっている）か。 */
  readonly blockedBy: string | null;
  /** 最後に動きがあってから何時間か。 */
  readonly lastActivityHours: number;
  /** 直近 7 日に何度出てきたか。 */
  readonly repetitions: number;
  /** 本人が付けた優先度（0..1）。無ければ 0。 */
  readonly explicitPriority: number;
}

export interface PressureResult {
  readonly id: string;
  readonly score: number;
  readonly factors: readonly WorkPressureFactor[];
}

const clamp = (x: number): number => Math.max(0, Math.min(1, x));
const round = (x: number): number => Math.round(x * 1000) / 1000;

export function deadlineUrgency(daysUntilDue: number | null): number {
  if (daysUntilDue === null) return 0;
  if (daysUntilDue <= 0) return 1;
  return clamp(Math.exp(-daysUntilDue / DEADLINE_TAU_DAYS));
}

export function unansweredPressure(hours: number | null, resent: boolean): number {
  if (hours === null) return 0;
  return clamp(hours / UNANSWERED_HOURS_FULL + (resent ? 0.3 : 0));
}

export function calendarDensity(
  meetingsToday: number,
  minGapMinutes: number | null,
  hasPrepTask: boolean,
): number {
  if (meetingsToday <= 0) return 0;
  const density = clamp(meetingsToday / 5);
  const tight = minGapMinutes !== null && minGapMinutes < 30 ? 1 : 0.7;
  return clamp(density * tight + (hasPrepTask ? 0.2 : 0));
}

export function dependencyBlock(blockedBy: string | null, daysUntilDue: number | null): number {
  if (!blockedBy) return 0;
  return clamp(0.8 + (daysUntilDue !== null && daysUntilDue <= 2 ? 0.2 : 0));
}

export function recency(lastActivityHours: number): number {
  return clamp(Math.exp(-Math.max(0, lastActivityHours) / 72));
}

export function repetition(count: number): number {
  return clamp(count / 5);
}

function reasonFor(name: WorkPressureFactorName, input: PressureInput, value: number): string {
  switch (name) {
    case 'deadline':
      if (input.daysUntilDue === null) return '期限なし';
      if (input.daysUntilDue <= 0) return '期限を過ぎている';
      if (input.daysUntilDue < 1) return '今日が期限';
      if (input.daysUntilDue < 2) return '明日が期限';
      return `${Math.ceil(input.daysUntilDue)} 日後が期限`;
    case 'unanswered':
      if (input.unansweredHours === null) return '返信待ちなし';
      return `${Math.round(input.unansweredHours)} 時間未返信${input.resent ? '（相手が再送）' : ''}`;
    case 'calendar':
      if (input.meetingsToday <= 0) return '今日の会議なし';
      return `今日 会議 ${input.meetingsToday} 件${input.minGapMinutes !== null && input.minGapMinutes < 30 ? '・間隔 30 分未満' : ''}${input.hasPrepTask ? '・準備あり' : ''}`;
    case 'dependency':
      return input.blockedBy ? `${input.blockedBy} 待ちで止まっている` : '依存なし';
    case 'recency':
      return `最終更新 ${Math.round(input.lastActivityHours)} 時間前`;
    case 'repetition':
      return `直近 7 日に ${input.repetitions} 回`;
    case 'explicit':
      return value > 0 ? '本人が優先と指定' : '優先指定なし';
  }
}

export function pressure(input: PressureInput): PressureResult {
  const values: Record<WorkPressureFactorName, number> = {
    deadline: deadlineUrgency(input.daysUntilDue),
    unanswered: unansweredPressure(input.unansweredHours, input.resent),
    calendar: calendarDensity(input.meetingsToday, input.minGapMinutes, input.hasPrepTask),
    dependency: dependencyBlock(input.blockedBy, input.daysUntilDue),
    recency: recency(input.lastActivityHours),
    repetition: repetition(input.repetitions),
    explicit: clamp(input.explicitPriority),
  };
  const factors: WorkPressureFactor[] = (Object.keys(WEIGHTS) as WorkPressureFactorName[]).map(
    (name) => ({
      name,
      value: round(values[name]),
      weight: WEIGHTS[name],
      contribution: round(values[name] * WEIGHTS[name]),
      reason: reasonFor(name, input, values[name]),
    }),
  );
  const score = round(clamp(factors.reduce((s, f) => s + f.contribution, 0)));
  return { id: input.id, score, factors };
}

/** 高い順、同点は id 昇順（決定的）。 */
export function rankPressure(inputs: readonly PressureInput[]): PressureResult[] {
  return inputs
    .map(pressure)
    .sort((a, b) => b.score - a.score || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}
