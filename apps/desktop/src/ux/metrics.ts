/**
 * UX の計測。UI/UX §23。
 *
 * 目盛りと、**手元で測った値**だけを持つ。送る先はまだ無い（§23 は目標値の表であって、
 * 送信先の仕様ではない）。設定の面で見られるようにして、AC-02 などを実機で確かめる。
 * 値は起動中の記憶だけ。保存しない。
 */
export type UxMetricName =
  | 'dock_summon'
  | 'mic_capture_start'
  | 'stt_first_partial'
  | 'long_task_ack'
  | 'simple_first_token';

export interface UxMetricSpec {
  readonly name: UxMetricName;
  readonly label: string;
  /** §23 の目標（p95, ms）。 */
  readonly targetMs: number;
}

export const UX_METRICS: readonly UxMetricSpec[] = [
  { name: 'dock_summon', label: 'Dock が出るまで', targetMs: 120 },
  { name: 'mic_capture_start', label: 'マイクが拾い始めるまで', targetMs: 150 },
  { name: 'stt_first_partial', label: '最初の文字が出るまで（手元 STT）', targetMs: 350 },
  { name: 'simple_first_token', label: '短い答えの最初の文字まで', targetMs: 800 },
  { name: 'long_task_ack', label: '長い仕事の受け付けまで', targetMs: 1000 },
];

const KEEP = 50;
const samples = new Map<UxMetricName, number[]>();
const listeners = new Set<() => void>();

export function recordUxMetric(name: UxMetricName, ms: number): void {
  if (!Number.isFinite(ms) || ms < 0) return;
  const list = samples.get(name) ?? [];
  list.push(Math.round(ms));
  if (list.length > KEEP) list.shift();
  samples.set(name, list);
  for (const l of listeners) l();
}

export function resetUxMetrics(): void {
  samples.clear();
  for (const l of listeners) l();
}

export function subscribeUxMetrics(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** 近い順位の値。標本が少なくても「無い」とは言わず、あるものから出す。 */
export function percentile(values: readonly number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, index)] ?? null;
}

export interface UxMetricSummary extends UxMetricSpec {
  readonly count: number;
  readonly last: number | null;
  readonly p95: number | null;
  /** 目標内か。標本が無ければ null（測っていないものを「達成」と言わない）。 */
  readonly withinTarget: boolean | null;
}

export function summarizeUxMetrics(): readonly UxMetricSummary[] {
  return UX_METRICS.map((spec) => {
    const values = samples.get(spec.name) ?? [];
    const p95 = percentile(values, 95);
    return {
      ...spec,
      count: values.length,
      last: values.at(-1) ?? null,
      p95,
      withinTarget: p95 === null ? null : p95 <= spec.targetMs,
    };
  });
}

/** 経過を測る小さな道具。`const done = startUxTimer('x'); … done();` */
export function startUxTimer(name: UxMetricName): () => void {
  const t0 = performance.now();
  let fired = false;
  return () => {
    if (fired) return;
    fired = true;
    recordUxMetric(name, performance.now() - t0);
  };
}
