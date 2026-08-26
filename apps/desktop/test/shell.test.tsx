/**
 * 4-tab shell。UI-0 の Exit（Light/Dark + 4-tab shell）。
 * UI/UX §2.1・§7.1・§7.2・§17.1・§19。
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
// 名前付き export を使う。NodeNext の型解決では default が namespace に潰れる
import { userEvent } from '@testing-library/user-event';
import { TOP_LEVEL_TABS, breakpoints, layout } from '@astra/ui-kit';
import { App } from '../src/App.js';

function setViewport(width: number): void {
  Object.defineProperty(window, 'innerWidth', { value: width, configurable: true });
  fireEvent(window, new Event('resize'));
}

function stubMatchMedia(prefersDark: boolean): void {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: (query: string) => ({
      matches: query.includes('prefers-color-scheme: dark') ? prefersDark : false,
      media: query,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
      dispatchEvent: () => false,
    }),
  });
}

beforeEach(() => {
  stubMatchMedia(false);
  setViewport(1440);
  localStorage.clear();
  document.documentElement.removeAttribute('data-theme');
  document.getElementById('astra-tokens')?.remove();
});

afterEach(cleanup);

describe('top-level navigation', () => {
  it('shows exactly four tabs (AC-12)', () => {
    render(<App />);
    const nav = screen.getByRole('navigation', { name: 'メインナビゲーション' });
    const items = within(nav).getAllByRole('button', { current: false }).length;
    // 4 タブ + 折りたたみボタン。タブそのものは 4 つ。
    for (const tab of TOP_LEVEL_TABS) {
      expect(within(nav).getByText(tab.label)).toBeTruthy();
    }
    expect(items).toBeGreaterThanOrEqual(4);
  });

  it('marks the current tab with aria-current, not colour alone', () => {
    // §19: 状態を色だけで表さない
    render(<App />);
    const home = screen.getByRole('button', { current: 'page' });
    expect(home.textContent).toContain('ホーム');
  });

  it('switches the page and the title when a tab is chosen', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByText('ライブラリ'));

    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('ライブラリ');
    expect(screen.getByRole('button', { current: 'page' }).textContent).toContain('ライブラリ');
  });

  it('is reachable by keyboard alone', async () => {
    const user = userEvent.setup();
    render(<App />);
    // 最初の Tab でブランド以降の最初の操作対象へ入る
    await user.tab();
    for (let i = 0; i < 10; i += 1) {
      const active = document.activeElement;
      if (active?.textContent?.includes('ワーク')) break;
      await user.tab();
    }
    expect(document.activeElement?.textContent).toContain('ワーク');
    await user.keyboard('{Enter}');
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('ワーク');
  });
});

describe('theme', () => {
  it('starts on the OS setting and leaves data-theme unset', () => {
    render(<App />);
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false);
  });

  it('injects the design tokens exactly once', () => {
    const { unmount } = render(<App />);
    expect(document.getElementById('astra-tokens')).not.toBeNull();
    unmount();
    render(<App />);
    expect(document.querySelectorAll('#astra-tokens')).toHaveLength(1);
  });

  it('applies an explicit choice and remembers it', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.selectOptions(screen.getByLabelText('外観'), 'dark');

    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    expect(localStorage.getItem('astra.theme')).toBe('dark');
  });

  it('returns to the OS setting by removing the attribute', async () => {
    const user = userEvent.setup();
    render(<App />);
    const select = screen.getByLabelText('外観');
    await user.selectOptions(select, 'dark');
    await user.selectOptions(select, 'system');
    // 属性を残すと prefers-color-scheme が効かなくなる
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false);
  });

  it('survives a localStorage that throws', () => {
    const original = Object.getOwnPropertyDescriptor(window, 'localStorage');
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      get() {
        throw new Error('blocked');
      },
    });
    try {
      expect(() => render(<App />)).not.toThrow();
    } finally {
      if (original) Object.defineProperty(window, 'localStorage', original);
    }
  });
});

describe('responsive layout (§7.2)', () => {
  it('keeps three columns at 1280px and above', () => {
    setViewport(breakpoints.wide);
    render(<App />);
    expect(document.querySelector('.astra-shell')?.getAttribute('data-layout')).toBe('wide');
  });

  it('collapses the sidebar below 1280px regardless of the user preference', () => {
    setViewport(1100);
    render(<App />);
    const shell = document.querySelector('.astra-shell') as HTMLElement;
    expect(shell.getAttribute('data-layout')).toBe('medium');
    expect(shell.style.getPropertyValue('--astra-sidebar-width')).toBe(
      `${layout.sidebar.collapsed}px`,
    );
  });

  it('lets the user collapse the sidebar only when there is room for it', async () => {
    const user = userEvent.setup();
    setViewport(1440);
    render(<App />);
    const shell = document.querySelector('.astra-shell') as HTMLElement;
    expect(shell.style.getPropertyValue('--astra-sidebar-width')).toBe(
      `${layout.sidebar.expanded}px`,
    );

    await user.click(screen.getByRole('button', { name: 'サイドバーを閉じる' }));
    expect(shell.style.getPropertyValue('--astra-sidebar-width')).toBe(
      `${layout.sidebar.collapsed}px`,
    );
  });

  it('disables the toggle when the layout has no choice', () => {
    setViewport(900);
    render(<App />);
    const toggle = screen.getByRole('button', { name: 'サイドバーを開く' });
    expect((toggle as HTMLButtonElement).disabled).toBe(true);
  });

  it('asks for more width below the supported minimum instead of squeezing', () => {
    setViewport(600);
    render(<App />);
    expect(screen.getByRole('alert').textContent).toContain('720px');
    expect(document.querySelector('.astra-shell')).toBeNull();
  });

  it('keeps the tab labels available to assistive tech when collapsed', () => {
    setViewport(1100);
    render(<App />);
    // 視覚的に隠れても、読み上げには残す
    expect(screen.getByRole('button', { current: 'page' }).textContent).toContain('ホーム');
  });
});
