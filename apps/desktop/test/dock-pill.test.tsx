/**
 * 上部ピル ↔ 入力カード。Voice OS 型の入口。
 *
 *   IDLE（ピル）── Option+Space ──▶ READY（カード）── Esc ──▶ IDLE（ピル）
 *   IDLE（ピル）── 長押し ──▶ LISTENING（ピルのまま）── 離す ──▶ 送る / IDLE
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render } from '@testing-library/react';

const host = {
  setDockState: vi.fn<(state: string, contentHeight?: number, jump?: boolean) => Promise<void>>(
    async () => undefined,
  ),
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

describe('recording (SuperIntern style, bottom)', () => {
  const live = {
    phase: 'live' as const,
    state: 'recording' as const,
    title: 'A社 商談',
    elapsedMs: 222_000,
    lines: [{ id: 'l1', speakerTag: 1, text: '来月までに', interim: false }],
  };

  it('drops to the recording dock while the meeting is live and sends stop as a command', async () => {
    const onMeetingCommand = vi.fn();
    const { rerender } = render(
      <TaskDock initialState="IDLE" meeting={live} onMeetingCommand={onMeetingCommand} />,
    );
    await act(async () => {});
    expect(dock().dataset['state']).toBe('RECORDING');
    expect(dock().dataset['geometry']).toBe('recording');
    expect(dock().textContent).toContain('03:42');

    // Esc では止めない。止めるのは ■ から
    await act(async () => {
      fireEvent.keyDown(window, { key: 'Escape', code: 'Escape' });
    });
    expect(dock().dataset['state']).toBe('RECORDING');

    fireEvent.click(document.querySelector('[aria-label="録音を止める"]')!);
    expect(onMeetingCommand).toHaveBeenCalledWith('stop');

    // main が finalizing に入ったら「保存しました」を見せ、少ししてピルへ
    rerender(
      <TaskDock
        initialState="IDLE"
        meeting={{ ...live, phase: 'finalizing' }}
        onMeetingCommand={onMeetingCommand}
      />,
    );
    await act(async () => {});
    expect(dock().dataset['state']).toBe('PROCESSING');
    expect(dock().textContent).toContain('会議を保存しました');
    await act(async () => {
      vi.advanceTimersByTime(1000);
    });
    expect(dock().dataset['state']).toBe('IDLE');
  });

  it('CC shows the latest lines above the bar', async () => {
    render(<TaskDock initialState="IDLE" meeting={live} />);
    await act(async () => {});
    fireEvent.click(document.querySelector('[aria-label="文字起こしを見る"]')!);
    expect(dock().textContent).toContain('来月までに');
  });
});

describe('quick menu on the pill', () => {
  it('opens on click with the three real actions and hands 会議を記録 to the main window', async () => {
    const onMeetingCommand = vi.fn();
    render(<TaskDock initialState="IDLE" onMeetingCommand={onMeetingCommand} />);
    await act(async () => {});
    fireEvent.click(document.querySelector('.astra-pill--idle')!);
    expect(dock().dataset['geometry']).toBe('menu');
    const items = [...document.querySelectorAll('[role="menuitem"]')].map((b) => b.textContent);
    expect(items).toEqual(['⌨文字で頼む', '🎤声で頼む', '●会議を記録']);

    fireEvent.click(document.querySelectorAll('[role="menuitem"]')[2]!);
    expect(onMeetingCommand).toHaveBeenCalledWith('start');
    expect(dock().dataset['state']).toBe('IDLE');
    expect(dock().dataset['geometry']).toBe('idle');
  });

  it('文字で頼む opens the card; Esc closes the menu', async () => {
    render(<TaskDock initialState="IDLE" />);
    await act(async () => {});
    fireEvent.click(document.querySelector('.astra-pill--idle')!);
    await act(async () => {
      fireEvent.keyDown(window, { key: 'Escape', code: 'Escape' });
    });
    expect(dock().dataset['geometry']).toBe('idle');
    fireEvent.click(document.querySelector('.astra-pill--idle')!);
    fireEvent.click(document.querySelector('[role="menuitem"]')!);
    expect(dock().dataset['state']).toBe('READY');
    expect(dock().dataset['surface']).toBe('card');
  });
});
