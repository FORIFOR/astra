/**
 * UX Performance SLO。正本 §23。
 *
 * **測っていないものを「守っている」と言わない。**
 */
import { describe, expect, it } from 'vitest';
import {
  MEASURED,
  PROGRESS_REQUIRED_AFTER_MS,
  SLO_TARGETS,
  p95,
  withinBudget,
} from '../src/slo.js';

describe('SLO_TARGETS', () => {
  it('carries every target the spec lists', () => {
    // 数字を 1 箇所に置く。散らすと、どれが正か分からなくなる。
    expect(Object.keys(SLO_TARGETS)).toHaveLength(10);
    expect(SLO_TARGETS.dockShow.budgetMs).toBe(120);
    expect(SLO_TARGETS.homeCachedLoad.budgetMs).toBe(300);
    expect(SLO_TARGETS.simpleReadTool.budgetMs).toBe(PROGRESS_REQUIRED_AFTER_MS);
  });

  it('says what each one means, so a number alone is never the record', () => {
    for (const [name, target] of Object.entries(SLO_TARGETS)) {
      expect(target.description.length, name).toBeGreaterThan(0);
      expect(target.budgetMs, name).toBeGreaterThan(0);
    }
  });
});

describe('MEASURED', () => {
  it('is honest about how little is actually checked', () => {
    // ここに無いものは、目標はあるが確かめていない
    expect(MEASURED.length).toBeLessThan(Object.keys(SLO_TARGETS).length);
    for (const name of MEASURED) expect(SLO_TARGETS[name]).toBeDefined();
  });
});

describe('withinBudget', () => {
  it('treats exactly the budget as within it', () => {
    expect(withinBudget({ name: 'dockShow', elapsedMs: 120 })).toBe(true);
    expect(withinBudget({ name: 'dockShow', elapsedMs: 121 })).toBe(false);
  });
});

describe('p95', () => {
  it('says nothing when there is nothing to say', () => {
    // 標本が無いときに 0 と言うと、速いように見える
    expect(p95([])).toBeNull();
  });

  it('takes a high sample, not the average', () => {
    const samples = [10, 10, 10, 10, 10, 10, 10, 10, 10, 900];
    expect(p95(samples)).toBe(900);
  });

  it('handles a single sample', () => {
    expect(p95([42])).toBe(42);
  });
});
