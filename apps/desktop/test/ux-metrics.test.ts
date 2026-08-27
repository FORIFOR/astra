/** §23 の計測。測っていないものを「達成」と言わない。 */
import { beforeEach, describe, expect, it } from 'vitest';
import {
  percentile,
  recordUxMetric,
  resetUxMetrics,
  summarizeUxMetrics,
} from '../src/ux/metrics.js';

beforeEach(resetUxMetrics);

describe('ux metrics (§23)', () => {
  it('reports unknown, not achieved, when nothing was measured', () => {
    const dock = summarizeUxMetrics().find((m) => m.name === 'dock_summon')!;
    expect(dock.count).toBe(0);
    expect(dock.p95).toBeNull();
    expect(dock.withinTarget).toBeNull();
    expect(dock.targetMs).toBe(120);
  });

  it('computes p95 and compares it to the target', () => {
    for (const ms of [40, 60, 80, 100, 500]) recordUxMetric('dock_summon', ms);
    const dock = summarizeUxMetrics().find((m) => m.name === 'dock_summon')!;
    expect(dock.count).toBe(5);
    expect(dock.p95).toBe(500);
    expect(dock.withinTarget).toBe(false);
    expect(dock.last).toBe(500);
  });

  it('ignores nonsense values', () => {
    recordUxMetric('mic_capture_start', Number.NaN);
    recordUxMetric('mic_capture_start', -5);
    expect(summarizeUxMetrics().find((m) => m.name === 'mic_capture_start')!.count).toBe(0);
  });

  it('percentile is nearest-rank', () => {
    expect(percentile([], 95)).toBeNull();
    expect(percentile([10], 95)).toBe(10);
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 50)).toBe(5);
  });
});
