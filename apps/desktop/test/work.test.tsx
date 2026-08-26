/**
 * Work Surface。UI-2。UI/UX §6・§9・§14.1・§21。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { uuidv7, type EventEnvelope } from '@astra/contracts';
import {
  applyEvent,
  applyEvents,
  emptyWorkView,
  formatElapsed,
  type WorkView,
} from '../src/work/workView.js';
import { WorkCard } from '../src/work/WorkCard.js';
import { WorkPage, matchesFilter, WORK_FILTERS } from '../src/pages/Work.js';

afterEach(cleanup);

const base = {
  event_id: uuidv7(),
  timestamp: new Date().toISOString(),
  tenant_id: uuidv7(),
  stream_kind: 'task' as const,
  stream_id: uuidv7(),
};

const evt = (sequence: number, type: string, payload: unknown): EventEnvelope =>
  ({ ...base, event_id: uuidv7(), type, sequence, payload }) as EventEnvelope;

const started = (sequence: number, stepCount: number | null) =>
  evt(sequence, 'task.started', { kind: 'echo', title: 'A社 商談準備', step_count: stepCount });

const progress = (
  sequence: number,
  over: Partial<{
    step_index: number | null;
    step_count: number | null;
    message: string;
    detail: string | null;
    elapsed_ms: number | null;
    retrying: boolean;
  }> = {},
) =>
  evt(sequence, 'task.progress', {
    phase: 'researching',
    step_index: 0,
    step_count: null,
    message: '競合情報を調査中',
    detail: null,
    elapsed_ms: null,
    retrying: false,
    ...over,
  });

describe('event folding (§6.1)', () => {
  it('speaks in work, not in agents or tool calls', () => {
    const view = applyEvents(emptyWorkView, [
      started(1, 3),
      evt(2, 'tool.started', {
        step_index: 0,
        tool_id: 'web.search',
        risk: 'READ',
        surface: 'cloud',
      }),
      progress(3, { step_index: 0, detail: '12 sources' }),
    ]);
    expect(view.title).toBe('A社 商談準備');
    expect(view.steps[0]?.label).toBe('競合情報を調査中');
    expect(view.steps[0]?.detail).toBe('12 sources');
    // tool 名は view に持ち込まない
    expect(JSON.stringify(view)).not.toContain('web.search');
  });

  it('shows a percentage only when the real progress is computable (§6.2)', () => {
    const known = applyEvents(emptyWorkView, [
      started(1, 4),
      evt(2, 'tool.completed', {
        step_index: 0,
        tool_id: 't',
        ok: true,
        receipt_id: null,
        duration_ms: 1,
      }),
    ]);
    expect(known.percent).toBe(25);

    const unknown = applyEvents(emptyWorkView, [started(1, null), progress(2)]);
    // 段数が決まらない処理で推定 % を出さない
    expect(unknown.percent).toBeNull();
  });

  it('replaces a retrying step instead of pinning it as failed (§6.2)', () => {
    const view = applyEvents(emptyWorkView, [
      started(1, 2),
      progress(2, { retrying: true, message: 'Gmail の応答が遅れています' }),
    ]);
    expect(view.steps[0]?.state).toBe('retrying');
    expect(view.error).toBeNull();
  });

  it('keeps approval out of the progress stream (§6.2)', () => {
    const view = applyEvents(emptyWorkView, [
      started(1, 2),
      evt(3, 'task.waiting_approval', {
        approval_id: uuidv7(),
        risk: 'EXTERNAL_COMMIT',
        summary: '3人にメールを送信します',
        primary_action_label: '3件送信する',
        expires_at: new Date().toISOString(),
      }),
    ]);
    expect(view.status).toBe('WAITING_APPROVAL');
    expect(view.attention?.primaryActionLabel).toBe('3件送信する');
  });

  it('ignores an event it has already folded in', () => {
    const first = applyEvent(emptyWorkView, started(1, 2));
    const again = applyEvent(first, started(1, 2));
    expect(again).toBe(first);
  });

  it('advances past an unknown event type without changing the view', () => {
    const view = applyEvents(emptyWorkView, [
      started(1, 1),
      evt(2, 'future.thing.v9', { anything: true }),
    ]);
    expect(view.lastSequence).toBe(2);
    expect(view.title).toBe('A社 商談準備');
  });

  it('closes out every step when the task completes', () => {
    const artifactId = uuidv7();
    const view = applyEvents(emptyWorkView, [
      started(1, 2),
      progress(2, { step_index: 0 }),
      evt(3, 'artifact.created', {
        artifact_id: artifactId,
        type: 'DOCUMENT',
        title: 'x',
        size: 1,
      }),
      evt(4, 'task.completed', { result_artifact_id: artifactId, duration_ms: 8000 }),
    ]);
    expect(view.status).toBe('COMPLETED');
    expect(view.steps.every((s) => s.state === 'done')).toBe(true);
    expect(view.resultArtifactId).toBe(artifactId);
    expect(view.percent).toBe(100);
  });

  it('records what the user can do next when it fails (§21)', () => {
    const view = applyEvents(emptyWorkView, [
      started(1, 1),
      progress(2),
      evt(3, 'task.failed', {
        error: {
          code: 'plugin.permission_denied',
          message: 'x',
          step_index: 0,
          retryable: false,
          recovery: 'grant_permission',
        },
      }),
    ]);
    expect(view.status).toBe('FAILED');
    expect(view.error?.recovery).toBe('grant_permission');
    expect(view.steps[0]?.state).toBe('failed');
  });

  it('formats elapsed time for humans', () => {
    expect(formatElapsed(null)).toBeNull();
    expect(formatElapsed(8_000)).toBe('8秒');
    expect(formatElapsed(60_000)).toBe('1分');
    expect(formatElapsed(95_000)).toBe('1分35秒');
  });
});

describe('WorkCard (§6 / §14.1)', () => {
  const waiting = applyEvents(emptyWorkView, [
    started(1, 2),
    progress(2, { step_index: 0, detail: '12 sources' }),
    evt(3, 'task.waiting_approval', {
      approval_id: 'ap-1',
      risk: 'EXTERNAL_COMMIT',
      summary: '3人にメールを送信します',
      primary_action_label: '3件送信する',
      expires_at: new Date().toISOString(),
    }),
  ]);

  it('writes the consequence on the primary button, not "承認"', async () => {
    const onApprove = vi.fn();
    const user = userEvent.setup();
    render(<WorkCard view={waiting} onApprove={onApprove} />);

    const primary = screen.getByRole('button', { name: '3件送信する' });
    expect(screen.queryByRole('button', { name: '承認' })).toBeNull();
    await user.click(primary);
    expect(onApprove).toHaveBeenCalledWith('ap-1');
  });

  it('names each step state in text, not colour alone (§19)', () => {
    render(<WorkCard view={waiting} />);
    expect(screen.getByText('進行中')).toBeTruthy();
    expect(screen.getByText('12 sources')).toBeTruthy();
  });

  it('omits the progress bar when there is no real percentage', () => {
    const unknown = applyEvents(emptyWorkView, [started(1, null), progress(2)]);
    render(<WorkCard view={unknown} />);
    expect(screen.queryByRole('progressbar')).toBeNull();
  });

  it('shows the bar when the progress is real', () => {
    const known = applyEvents(emptyWorkView, [
      started(1, 4),
      evt(2, 'tool.completed', {
        step_index: 0,
        tool_id: 't',
        ok: true,
        receipt_id: null,
        duration_ms: 1,
      }),
    ]);
    render(<WorkCard view={known} />);
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('25');
  });

  it('offers stop separately from dismiss while running (§4.4)', async () => {
    const onStop = vi.fn();
    const user = userEvent.setup();
    const running = applyEvents(emptyWorkView, [started(1, 2), progress(2)]);
    render(<WorkCard view={running} onStop={onStop} />);

    await user.click(screen.getByRole('button', { name: '停止する' }));
    expect(onStop).toHaveBeenCalled();
  });

  it('hides stop once the task is finished', () => {
    const done = applyEvents(emptyWorkView, [
      started(1, 1),
      evt(2, 'task.completed', { result_artifact_id: null, duration_ms: 10 }),
    ]);
    render(<WorkCard view={done} onStop={() => undefined} />);
    expect(screen.queryByRole('button', { name: '停止する' })).toBeNull();
  });

  it('explains the impact and the next action on failure (§21)', () => {
    const failed = applyEvents(emptyWorkView, [
      started(1, 1),
      evt(2, 'task.failed', {
        error: {
          code: 'common.unavailable',
          message: 'x',
          step_index: 0,
          retryable: true,
          recovery: 'retry',
        },
      }),
    ]);
    render(<WorkCard view={failed} />);
    const alert = screen.getByRole('alert');
    // 「AI が失敗しました」で終わらせない
    expect(alert.textContent).toContain('途中までの結果は保存されています');
    expect(alert.textContent).toContain('もう一度試せます');
  });
});

describe('Work tab (§9)', () => {
  const task = (status: string, title: string) =>
    ({
      id: uuidv7(),
      tenant_id: uuidv7(),
      created_by: uuidv7(),
      conversation_id: null,
      kind: 'echo',
      title,
      status,
      input: {},
      result_artifact_id: null,
      error: null,
      created_at: new Date().toISOString(),
      started_at: null,
      completed_at: null,
      updated_at: new Date().toISOString(),
      dockState: 'WORKING',
    }) as never;

  it('offers exactly the filters the spec lists', () => {
    expect(WORK_FILTERS.map((f) => f.id)).toEqual(['active', 'waiting', 'done', 'failed', 'all']);
  });

  it('classifies every status into a filter', () => {
    const statuses = [
      'PENDING',
      'RUNNING',
      'WAITING_APPROVAL',
      'CANCELLING',
      'COMPLETED',
      'FAILED',
      'CANCELLED',
    ] as const;
    for (const status of statuses) {
      expect(matchesFilter(status, 'all'), status).toBe(true);
      const specific = WORK_FILTERS.filter((f) => f.id !== 'all' && matchesFilter(status, f.id));
      expect(specific.length, `${status} belongs to no filter`).toBe(1);
    }
  });

  it('starts on active work and switches filters', async () => {
    const user = userEvent.setup();
    render(
      <WorkPage tasks={[task('RUNNING', '競合20社調査'), task('COMPLETED', '半導体市場調査')]} />,
    );
    expect(screen.getByText('競合20社調査')).toBeTruthy();
    expect(screen.queryByText('半導体市場調査')).toBeNull();

    await user.click(screen.getByRole('button', { name: '完了' }));
    expect(screen.getByText('半導体市場調査')).toBeTruthy();
    expect(screen.queryByText('競合20社調査')).toBeNull();
  });

  it('says so plainly when there is nothing to show', () => {
    render(<WorkPage tasks={[]} />);
    expect(screen.getByText('進行中の仕事はありません。')).toBeTruthy();
  });
});

describe('what a failure tells the person (§24)', () => {
  const failed = (explanation: string | null): WorkView =>
    ({
      title: '見積送信',
      status: 'FAILED',
      steps: [],
      percent: null,
      attention: null,
      resultArtifactId: null,
      error: { code: 'task.step_failed', recovery: 'handoff', explanation },
      elapsedMs: 1_000,
      startedAt: null,
      endedAt: null,
      lastSequence: 1,
    }) as WorkView;

  it('says what was tried and what was not available', () => {
    render(
      <WorkCard
        view={failed(
          'もう一度試す・別の経路で試すまで試しました。ブラウザを操作して試すは使えません（この環境に繋がっていません）。',
        )}
      />,
    );
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain('別の経路で試すまで試しました');
    // 持っていないものを、試して駄目だったことにしない
    expect(alert.textContent).toContain('ブラウザを操作して試すは使えません');
    expect(alert.textContent).toContain('手動での対応が必要です');
  });

  it('says nothing extra when there is no trail', () => {
    render(<WorkCard view={failed(null)} />);
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain('完了できませんでした');
    // 「試しました」と嘘をつくより、黙るほうがよい
    expect(alert.textContent).not.toContain('試しました');
  });

  it('does not leak the tool that failed', () => {
    render(
      <WorkCard
        view={failed('もう一度試すまで試しました。別の経路で試すは使えません（理由不明）。')}
      />,
    );
    // §7.2: tool 名を利用者に見せない
    expect(screen.getByRole('alert').textContent ?? '').not.toMatch(/gmail|crm\.|\.send/);
  });
});
