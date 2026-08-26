/**
 * 割り込み。UI/UX §16。
 *
 * **brief をそのまま OS へ流さない。**
 * brief は見に来た人向けで、こちらは割り込みなので基準が違う。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, waitFor } from '@testing-library/react';
import { uuidv7, type BriefItem, type DailyBrief } from '@astra/contracts';
import { useProactiveNotifications } from '../src/home/useProactive.js';
import { notifications } from '../src/host/tauri.js';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const NOON = new Date('2026-08-27T12:00:00');
const NIGHT = new Date('2026-08-27T02:00:00');

const item = (over: Partial<BriefItem> = {}): BriefItem =>
  ({
    id: `task:${uuidv7()}`,
    severity: 'action-required',
    title: '送信の確認',
    detail: 'A社へ見積を送ります',
    action_label: '確認する',
    target: { kind: 'task', task_id: uuidv7() },
    score: 0.9,
    ...over,
  }) as BriefItem;

const brief = (items: BriefItem[]): DailyBrief =>
  ({
    attention: items.slice(0, 3),
    more: items.slice(3),
    generated_at: NOON.toISOString(),
  }) as DailyBrief;

function Harness({
  feed,
  now = () => NOON,
  onUndelivered,
}: {
  feed: DailyBrief | null;
  now?: () => Date;
  onUndelivered?: (i: BriefItem, r: string) => void;
}): null {
  useProactiveNotifications(feed, { now, ...(onUndelivered ? { onUndelivered } : {}) });
  return null;
}

describe('what reaches the OS', () => {
  it('sends an approval that is waiting', async () => {
    const send = vi.spyOn(notifications, 'send').mockResolvedValue(undefined as never);
    render(<Harness feed={brief([item()])} />);
    await waitFor(() =>
      expect(send).toHaveBeenCalledWith('action-required', '送信の確認', 'A社へ見積を送ります'),
    );
  });

  it('never sends what belongs on Home, however high it scores', async () => {
    const send = vi.spyOn(notifications, 'send').mockResolvedValue(undefined as never);
    render(
      <Harness
        feed={brief([
          item({ severity: 'info', score: 1 }),
          item({ severity: 'attention', score: 1 }),
        ])}
      />,
    );
    // 「調査が終わりました」で OS 通知を鳴らさない（§16）
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(send).not.toHaveBeenCalled();
  });

  it('holds a higher bar than the brief does', async () => {
    const send = vi.spyOn(notifications, 'send').mockResolvedValue(undefined as never);
    render(<Harness feed={brief([item({ score: 0.2 })])} />);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(send).not.toHaveBeenCalled();
  });
});

describe('at night', () => {
  it('stays quiet about an approval', async () => {
    const send = vi.spyOn(notifications, 'send').mockResolvedValue(undefined as never);
    render(<Harness feed={brief([item()])} now={() => NIGHT} />);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(send).not.toHaveBeenCalled();
  });

  it('still speaks when staying quiet would be worse', async () => {
    const send = vi.spyOn(notifications, 'send').mockResolvedValue(undefined as never);
    render(
      <Harness
        feed={brief([item({ severity: 'critical', title: '録音に失敗しました' })])}
        now={() => NIGHT}
      />,
    );
    await waitFor(() => expect(send).toHaveBeenCalled());
  });
});

describe('when the OS would not take it', () => {
  it('does not treat a failure as having been said', async () => {
    const undelivered = vi.fn();
    vi.spyOn(notifications, 'send').mockRejectedValue(new Error('通知が許可されていません'));
    const feed = brief([item()]);
    const { rerender } = render(<Harness feed={feed} onUndelivered={undelivered} />);
    await waitFor(() => expect(undelivered).toHaveBeenCalled());
    expect(undelivered.mock.calls[0]![1]).toContain('許可されていません');

    // 失敗を覚えていないので、次の brief でもう一度試す
    const send = vi.spyOn(notifications, 'send').mockResolvedValue(undefined as never);
    rerender(
      <Harness
        feed={{ ...feed, generated_at: new Date().toISOString() }}
        onUndelivered={undelivered}
      />,
    );
    await waitFor(() => expect(send).toHaveBeenCalled());
  });
});
