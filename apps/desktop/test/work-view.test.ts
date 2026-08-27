/**
 * 端末が落ちて止まった仕事の見え方。UI/UX §6・§21、正本 §4.4。
 *
 * ここで守るのは 1 点:
 * **待てば戻るものを、失敗として見せない。**
 */
import { describe, expect, it } from 'vitest';
import { uuidv7, type EventEnvelope } from '@astra/contracts';
import { applyEvents, emptyWorkView } from '../src/work/workView.js';

const base = {
  timestamp: '2026-08-27T09:00:00.000Z',
  tenant_id: uuidv7(),
  stream_kind: 'task' as const,
  stream_id: uuidv7(),
};

const evt = (sequence: number, type: string, payload: unknown): EventEnvelope =>
  ({ ...base, event_id: uuidv7(), type, sequence, payload }) as EventEnvelope;

const started = evt(1, 'task.started', { kind: 'echo', title: '請求書を送る', step_count: 2 });
const working = evt(2, 'task.progress', {
  phase: 'acting',
  step_index: 0,
  step_count: 2,
  message: '下書きを作っています',
  detail: null,
  elapsed_ms: 4000,
  retrying: false,
});
const paused = evt(3, 'task.paused', {
  reason: 'host_offline',
  step_index: 1,
  message: 'この操作は端末で行います。端末が戻るまで待っています。',
});
const resumed = evt(4, 'task.resumed', { step_index: 1, paused_ms: 120_000 });

describe('a task waiting for the device', () => {
  it('is paused, not failed', () => {
    const view = applyEvents(emptyWorkView, [started, working, paused]);
    expect(view.status).toBe('PAUSED_HOST_OFFLINE');
    // 失敗欄に入れない。入れると「完了できませんでした」と出る。
    expect(view.error).toBeNull();
    expect(view.pausedReason).toContain('端末');
  });

  it('keeps the work already done', () => {
    const view = applyEvents(emptyWorkView, [started, working, paused]);
    // 途中まで進んだ事実は消えていない
    expect(view.steps[0]!.label).toBe('下書きを作っています');
    expect(view.elapsedMs).toBe(4000);
  });

  it('goes back to running when the device returns', () => {
    const view = applyEvents(emptyWorkView, [started, working, paused, resumed]);
    expect(view.status).toBe('RUNNING');
    expect(view.pausedReason).toBeNull();
  });

  it('does not keep saying it is waiting once the task is finished', () => {
    const done = evt(5, 'task.completed', { result_artifact_id: null, duration_ms: 9000 });
    const view = applyEvents(emptyWorkView, [started, working, paused, done]);
    expect(view.status).toBe('COMPLETED');
    expect(view.pausedReason).toBeNull();
  });

  it('does not keep saying it is waiting once the task has really failed', () => {
    const failed = evt(5, 'task.failed', {
      error: {
        code: 'task.step_failed',
        message: 'なにか',
        step_index: 1,
        retryable: false,
        recovery: 'handoff',
        handoff_explanation: null,
      },
    });
    const view = applyEvents(emptyWorkView, [started, working, paused, failed]);
    expect(view.status).toBe('FAILED');
    expect(view.pausedReason).toBeNull();
    expect(view.error).not.toBeNull();
  });

  it('ignores a pause that arrives twice', () => {
    const once = applyEvents(emptyWorkView, [started, working, paused]);
    const twice = applyEvents(once, [paused]);
    expect(twice).toEqual(once);
  });
});
