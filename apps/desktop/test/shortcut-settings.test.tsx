/**
 * ショートカットの設定。UI/UX §20。
 *
 * §20 が要求する 3 つ目 —「OS/IME 競合を検出した場合は初回設定で
 * 代替候補を提示する」— を、実際に提示しているかで見る。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { ShortcutSettings } from '../src/settings/ShortcutSettings.js';
import { shortcuts } from '../src/host/tauri.js';

const flags = (over: Partial<Record<'primary' | 'alt' | 'shift' | 'control', boolean>> = {}) => ({
  primary: false,
  alt: false,
  shift: false,
  control: false,
  ...over,
});

beforeEach(() => {
  Object.defineProperty(window.navigator, 'userAgent', {
    configurable: true,
    value: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('when the default works', () => {
  it('shows the key that is actually registered, not a hard-coded one', async () => {
    vi.spyOn(shortcuts, 'status').mockResolvedValue([
      {
        id: 'dock.toggle',
        label: 'Task Dock を開く / 閉じる',
        code: 'Space',
        modifiers: flags({ alt: true }),
        usingDefault: true,
        alternates: [],
      },
    ]);
    render(<ShortcutSettings />);
    await waitFor(() => expect(screen.getByText('Option + Space')).toBeTruthy());
    expect(screen.queryByText(/ほかで使われていました/)).toBeNull();
  });
});

describe('when the OS or the IME already took it', () => {
  it('says so and offers candidates the user can press', async () => {
    vi.spyOn(shortcuts, 'status').mockResolvedValue([
      {
        id: 'dock.toggle',
        label: 'Task Dock を開く / 閉じる',
        // 既定が取られたので代替で登録されている
        code: 'Space',
        modifiers: flags({ alt: true, shift: true }),
        usingDefault: false,
        alternates: [{ code: 'KeyJ', modifiers: flags({ primary: true, shift: true }) }],
      },
    ]);
    render(<ShortcutSettings />);

    await waitFor(() => expect(screen.getByText(/ほかで使われていました/)).toBeTruthy());
    expect(screen.getByText('Option + Shift + Space')).toBeTruthy();
    // 候補は、押せば実際に変わるものとして出す
    expect(screen.getByRole('button', { name: 'Shift + Command + J にする' })).toBeTruthy();
  });

  it('changes the binding when a candidate is chosen', async () => {
    vi.spyOn(shortcuts, 'status').mockResolvedValue([
      {
        id: 'dock.toggle',
        label: 'Task Dock を開く / 閉じる',
        code: 'Space',
        modifiers: flags({ alt: true, shift: true }),
        usingDefault: false,
        alternates: [{ code: 'KeyJ', modifiers: flags({ primary: true, shift: true }) }],
      },
    ]);
    const rebind = vi.spyOn(shortcuts, 'rebind').mockResolvedValue(null as never);

    render(<ShortcutSettings />);
    await userEvent.click(
      await screen.findByRole('button', { name: 'Shift + Command + J にする' }),
    );
    expect(rebind).toHaveBeenCalledWith(
      'dock.toggle',
      'KeyJ',
      flags({ primary: true, shift: true }),
    );
  });

  it('does not swallow a rebind that failed', async () => {
    vi.spyOn(shortcuts, 'status').mockResolvedValue([
      {
        id: 'dock.toggle',
        label: 'Task Dock を開く / 閉じる',
        code: 'Space',
        modifiers: flags({ alt: true }),
        usingDefault: true,
        alternates: [{ code: 'KeyJ', modifiers: flags({ primary: true, shift: true }) }],
      },
    ]);
    vi.spyOn(shortcuts, 'rebind').mockRejectedValue(new Error('that combination is already taken'));

    render(<ShortcutSettings />);
    await userEvent.click(
      await screen.findByRole('button', { name: 'Shift + Command + J にする' }),
    );
    // 変えたつもりで効いていない状態を作らない
    expect((await screen.findByRole('alert')).textContent).toContain('already taken');
  });
});

describe('when nothing could be registered at all', () => {
  it('says the shortcut is unusable and where to go instead', async () => {
    vi.spyOn(shortcuts, 'status').mockResolvedValue([
      {
        id: 'dock.toggle',
        label: 'Task Dock を開く / 閉じる',
        code: null,
        modifiers: flags(),
        usingDefault: false,
        alternates: [],
      },
    ]);
    render(<ShortcutSettings />);
    await waitFor(() =>
      expect(screen.getByText(/ほかのアプリに取られていて、いま使えません/)).toBeTruthy(),
    );
    // §21: 影響と次の選択肢を書く
    expect(screen.getByText(/アプリの画面からは今までどおり開けます/)).toBeTruthy();
  });
});

describe('outside Tauri', () => {
  it('falls back to the table rather than showing nothing', async () => {
    // ブラウザには global shortcut が無い。status は null を返す。
    vi.spyOn(shortcuts, 'status').mockResolvedValue(null);
    render(<ShortcutSettings />);
    // §20 の表そのものは出す（何が割り当たっているかは読める）
    await waitFor(() => expect(screen.getByText('Option + Space')).toBeTruthy());
    expect(screen.getByText('Shift + Command + C')).toBeTruthy();
  });
});
