/**
 * 上部ピル ↔ 入力カード。Voice OS 型の入口。
 *
 *   IDLE（ピル）── Option+Space ──▶ READY（カード）── Esc ──▶ IDLE（ピル）
 *   IDLE（ピル）── 長押し ──▶ LISTENING（ピルのまま）── 離す ──▶ 送る / IDLE
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render } from '@testing-library/react';

const host = {
  setDockState: vi.fn(async () => undefined),
  focusDock: vi.fn(async () => undefined),
  hideDock: vi.fn(async () => undefined),
  showDock: vi.fn(async () => undefined),
  rememberDockPosition: vi.fn(async () => undefined),
  contextSnapshot: vi.fn(async () => null),
  onDockToggle: vi.fn(async (handler: () => void) => {
    toggle = handler;
    return () => undefined;
  }),
};
let toggle: (() => void) | null = null;
let hold: ((id: string, pressed: boolean) => void) | null = null;

vi.mock('../src/host/tauri.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../src/host/tauri.js')>();
  return {
    ...original,
    host: { ...original.host, ...host },
    shortcuts: {
      ...original.shortcuts,
      onHold: vi.fn(async (handler: (id: string, pressed: boolean) => void) => {
        hold = handler;
        return () => undefined;
      }),
    },
  };
});

const { TaskDock } = await import('../src/dock/TaskDock.js');

const dock = (): HTMLElement => document.querySelector('.astra-dock') as HTMLElement;
const lastGeometry = (): string | undefined =>
  host.setDockState.mock.calls.at(-1)?.[0] as string | undefined;

const dictation = {
  start: vi.fn(async () => undefined),
  stop: vi.fn(async () => undefined),
};

beforeEach(() => {
  host.setDockState.mockClear();
  host.focusDock.mockClear();
  toggle = null;
  hold = null;
  vi.useFakeTimers({ shouldAdvanceTime: true });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('the pill (Voice OS entrance)', () => {
  it('starts as the idle pill showing the push-to-talk keys', async () => {
    render(<TaskDock initialState="IDLE" dictation={dictation} />);
    await act(async () => {});
    expect(dock().dataset['state']).toBe('IDLE');
    expect(dock().dataset['geometry']).toBe('idle');
    expect(dock().textContent).toContain('長押しで音声入力');
    // キーの表記は OS ごと（macOS: option d / それ以外: alt ctrl d）。D が見えていればよい
    expect(dock().textContent?.toLowerCase()).toContain('d長押し');
  });

  it('Option+Space opens the card and Esc returns to the pill', async () => {
    render(<TaskDock initialState="IDLE" dictation={dictation} />);
    await act(async () => {});
    expect(toggle).not.toBeNull();
    await act(async () => toggle!());
    expect(dock().dataset['state']).toBe('READY');
    expect(dock().dataset['geometry']).toBe('ready');
    expect(host.focusDock).toHaveBeenCalled();

    await act(async () => {
      fireEvent.keyDown(window, { key: 'Escape', code: 'Escape' });
    });
    expect(dock().dataset['state']).toBe('IDLE');
    expect(dock().dataset['geometry']).toBe('idle');
    expect(lastGeometry()).toBe('idle');
  });

  it('push-to-talk listens inside the pill and falls back to idle when nothing was said', async () => {
    render(<TaskDock initialState="IDLE" dictation={dictation} />);
    await act(async () => {});
    expect(hold).not.toBeNull();
    await act(async () => hold!('dock.pushToTalk', true));
    expect(dock().dataset['state']).toBe('LISTENING');
    expect(dock().dataset['geometry']).toBe('pill');
    expect(dock().textContent).toContain('聞いています');

    await act(async () => hold!('dock.pushToTalk', false));
    expect(dock().dataset['state']).toBe('IDLE');
    expect(dock().dataset['geometry']).toBe('idle');
  });

  it('after the card was used once, the pill still listens as a pill', async () => {
    render(<TaskDock initialState="IDLE" dictation={dictation} />);
    await act(async () => {});
    await act(async () => toggle!());
    await act(async () => toggle!());
    expect(dock().dataset['state']).toBe('IDLE');
    await act(async () => hold!('dock.pushToTalk', true));
    expect(dock().dataset['geometry']).toBe('pill');
  });
});
