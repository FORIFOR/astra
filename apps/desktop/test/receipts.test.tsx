/**
 * 受け取りの控え。UI/UX §22・§14.1。
 *
 * 見たいのは「並んでいるか」ではなく、
 * **監査ログをそのまま出していないか**と、
 * **無い情報を埋めていないか**。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { uuidv7, type ActionReceiptView } from '@astra/contracts';
import { ReceiptList, Receipts } from '../src/work/Receipts.js';

afterEach(cleanup);

const NOW = new Date('2026-08-27T04:00:00.000Z');

const receipt = (over: Partial<ActionReceiptView> = {}): ActionReceiptView =>
  ({
    id: uuidv7(),
    task_id: uuidv7(),
    summary: 'A社へ見積を送りました',
    risk: 'EXTERNAL_COMMIT',
    actor: 'agent',
    approved_by_name: '堀尾',
    executed_at: '2026-08-27T03:30:00.000Z',
    reversible_until: null,
    result_ref: null,
    tool_id: 'gmail.send',
    ...over,
  }) as ActionReceiptView;

describe('what the receipt says', () => {
  it('shows the sentence the user agreed to, not the tool that ran it', () => {
    render(<ReceiptList receipts={[receipt()]} now={NOW} />);
    expect(screen.getByText('A社へ見積を送りました')).toBeTruthy();
    // 技術的な識別子は前面に出さない
    expect(screen.queryByText('gmail.send')?.closest('details')).toBeTruthy();
  });

  it('names the risk in words, not by colour or an enum', () => {
    render(<ReceiptList receipts={[receipt()]} now={NOW} />);
    expect(screen.getByText('外部への送信')).toBeTruthy();
    expect(screen.queryByText('EXTERNAL_COMMIT')).toBeNull();
  });

  it('says who confirmed it', () => {
    render(<ReceiptList receipts={[receipt()]} now={NOW} />);
    expect(screen.getByText('堀尾 が確認しました')).toBeTruthy();
  });

  it('does not invent a sentence for an action nobody confirmed', () => {
    render(
      <ReceiptList
        receipts={[receipt({ summary: null, approved_by_name: null, risk: 'REVERSIBLE_WRITE' })]}
        now={NOW}
      />,
    );
    expect(screen.getByText('確認を必要としない操作でした')).toBeTruthy();
    expect(screen.getByText('確認は不要でした')).toBeTruthy();
  });
});

describe('whether it can still be undone', () => {
  it('says the deadline while it is still open', () => {
    render(
      <ReceiptList
        receipts={[receipt({ reversible_until: '2026-08-27T05:00:00.000Z' })]}
        now={NOW}
      />,
    );
    expect(screen.getByText(/まで取り消せます/)).toBeTruthy();
  });

  it('does not keep offering an expired undo', () => {
    // 期限そのものを出すだけでは、過ぎたかどうかを読ませてしまう
    render(
      <ReceiptList
        receipts={[receipt({ reversible_until: '2026-08-27T03:40:00.000Z' })]}
        now={NOW}
      />,
    );
    expect(screen.getByText('取り消しはできません')).toBeTruthy();
  });

  it('says so when there was never an undo', () => {
    render(<ReceiptList receipts={[receipt({ reversible_until: null })]} now={NOW} />);
    expect(screen.getByText('取り消しはできません')).toBeTruthy();
  });
});

describe('when there is nothing to show', () => {
  it('separates "nothing happened" from "could not load"', async () => {
    const empty = { taskReceipts: vi.fn(async () => []) } as never;
    const { unmount } = render(<Receipts client={empty} taskId={uuidv7()} />);
    await waitFor(() => expect(screen.getByText(/外部への操作はまだありません/)).toBeTruthy());
    unmount();

    const broken = {
      taskReceipts: vi.fn(async () => {
        throw new Error('接続できません');
      }),
    } as never;
    render(<Receipts client={broken} taskId={uuidv7()} />);
    // 取れなかったことを、黙って空として見せない
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('接続できません'));
  });
});

describe('the technical record', () => {
  it('is available when asked for, and closed by default', async () => {
    render(<ReceiptList receipts={[receipt({ result_ref: 'msg-123' })]} now={NOW} />);
    const details = document.querySelector('details') as HTMLDetailsElement;
    expect(details.open).toBe(false);

    await userEvent.click(screen.getByText('詳しい記録'));
    expect(screen.getByText('gmail.send')).toBeTruthy();
    expect(screen.getByText('msg-123')).toBeTruthy();
    expect(screen.getByText('Astra')).toBeTruthy();
  });
});
