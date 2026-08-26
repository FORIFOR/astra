/**
 * 使う直前の許可のお願い。UI/UX §22。
 *
 * 初回設定で「必要になったときに改めて聞きます」と言っている。
 * **言ったなら、聞かなければならない。**
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { PermissionAsk } from '../src/dock/PermissionAsk.js';
import { permissions } from '../src/host/tauri.js';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('what it says before asking', () => {
  it('puts the purpose before the name of the permission', () => {
    render(<PermissionAsk missing={['accessibility']} />);
    const ask = screen.getByLabelText('許可のお願い');
    const text = ask.textContent ?? '';
    // 「選択したテキストを読み取るため」が「アクセシビリティ」より先に来る
    expect(text.indexOf('選択したテキストを読み取るため')).toBeLessThan(
      text.indexOf('アクセシビリティ'),
    );
  });

  it('says what is lost by saying no, before saying yes', () => {
    render(<PermissionAsk missing={['microphone']} />);
    expect(screen.getByText(/許さなくても続けられます/)).toBeTruthy();
    expect(screen.getByText(/会議の記録はできません/)).toBeTruthy();
  });

  it('shows nothing when nothing is missing', () => {
    const { container } = render(<PermissionAsk missing={[]} />);
    expect(container.textContent).toBe('');
  });

  it('does not ask for a permission it cannot name', () => {
    // 何を許せばいいか言えないものを出さない
    const { container } = render(<PermissionAsk missing={['telepathy']} />);
    expect(container.textContent).toBe('');
  });
});

describe('opening the settings', () => {
  it('does not claim the permission was granted', async () => {
    vi.spyOn(permissions, 'openSettings').mockResolvedValue(undefined as never);
    render(<PermissionAsk missing={['accessibility']} />);

    await userEvent.click(screen.getByRole('button', { name: '設定を開く' }));
    // 許可されたかは OS の中の話。開いたことしか言わない。
    await waitFor(() =>
      expect(screen.getByRole('status').textContent).toContain('設定を開きました'),
    );
    expect(screen.queryByText(/許可されました/)).toBeNull();
  });

  it('says so when the settings could not be opened', async () => {
    vi.spyOn(permissions, 'openSettings').mockRejectedValue(
      new Error('この OS では設定を自動で開けません'),
    );
    render(<PermissionAsk missing={['accessibility']} />);

    await userEvent.click(screen.getByRole('button', { name: '設定を開く' }));
    // 押したのに何も起きない、を作らない
    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toContain('設定を自動で開けません'),
    );
  });
});

describe('saying no', () => {
  it('stops asking for the one that was declined, and keeps the rest', async () => {
    const onDismiss = vi.fn();
    render(<PermissionAsk missing={['accessibility', 'microphone']} onDismiss={onDismiss} />);

    const declines = screen.getAllByRole('button', { name: '今はしない' });
    expect(declines).toHaveLength(2);
    await userEvent.click(declines[0]!);

    expect(onDismiss).toHaveBeenCalledWith('accessibility');
    expect(screen.queryByText(/選択したテキストを読み取るため/)).toBeNull();
    // 別の許可のお願いまで消さない
    expect(screen.getByText(/会議を録音し/)).toBeTruthy();
  });
});
