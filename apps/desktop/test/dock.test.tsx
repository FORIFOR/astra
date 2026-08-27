/**
 * Task Dock と Context Lens。UI-1。
 * UI/UX §3・§4.3・§4.4・§5。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import type { ContextSource } from '@astra/contracts';
import { TaskDock } from '../src/dock/TaskDock.js';
import { shortcuts } from '../src/host/tauri.js';

const source = (
  over: Partial<ContextSource> & Pick<ContextSource, 'id' | 'label'>,
): ContextSource => ({
  category: 'internal',
  reason: null,
  sensitivity: 'PRIVATE',
  removable: true,
  used: false,
  ...over,
});

beforeEach(() => {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: () => ({
      matches: false,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }),
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

/** 音声入力の代役。聞けないのに LISTENING に入らないので、試験では繋いで渡す。 */
const voice = {
  async start() {},
  async stop() {},
};

describe('intent bar (§4.3)', () => {
  it('offers text, voice and attach without naming any tool', () => {
    render(<TaskDock />);
    expect(screen.getByLabelText('依頼を入力')).toBeTruthy();
    expect(screen.getByRole('button', { name: '音声で入力する' })).toBeTruthy();
    // 技術的な tool 一覧を出さない
    expect(screen.getByRole('button', { name: 'ファイルや画面を追加する' })).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/MCP|connector|tool/i);
  });

  it('uses a plain placeholder instead of rotating feature examples', () => {
    render(<TaskDock />);
    expect(screen.getByPlaceholderText('何をしますか？')).toBeTruthy();
  });

  it('moves to TYPING as soon as there is input and back when cleared', async () => {
    const user = userEvent.setup();
    render(<TaskDock />);
    const field = screen.getByLabelText('依頼を入力');
    const dock = document.querySelector('.astra-dock') as HTMLElement;

    expect(dock.dataset['state']).toBe('READY');
    await user.type(field, 'A社の提案を直して');
    expect(dock.dataset['state']).toBe('TYPING');
    expect(dock.dataset['geometry']).toBe('typing');

    await user.clear(field);
    expect(dock.dataset['state']).toBe('READY');
  });

  it('sends on Enter and adds a newline on Shift+Enter', async () => {
    const user = userEvent.setup();
    render(<TaskDock />);
    const field = screen.getByLabelText('依頼を入力') as HTMLTextAreaElement;
    const dock = document.querySelector('.astra-dock') as HTMLElement;

    await user.type(field, '一行目{Shift>}{Enter}{/Shift}二行目');
    expect(field.value).toContain('\n');
    expect(dock.dataset['state']).toBe('TYPING');

    await user.type(field, '{Enter}');
    expect(dock.dataset['state']).toBe('UNDERSTANDING');
  });

  it('ignores a send with nothing to send', async () => {
    const user = userEvent.setup();
    render(<TaskDock />);
    await user.type(screen.getByLabelText('依頼を入力'), '   {Enter}');
    expect((document.querySelector('.astra-dock') as HTMLElement).dataset['state']).not.toBe(
      'UNDERSTANDING',
    );
  });

  it('shows a short status instead of a bare spinner (§3)', async () => {
    const user = userEvent.setup();
    render(<TaskDock />);
    await user.type(screen.getByLabelText('依頼を入力'), '調べて{Enter}');
    // HUD と同じ語彙（Deepgram の thinking）。「文脈を確認しています」は内部の段の名前だった。
    expect(screen.getByRole('status').textContent).toBe('考えています');
  });
});

describe('voice (§4.3)', () => {
  it('toggles listening and shows it in an accessible way', async () => {
    const user = userEvent.setup();
    render(<TaskDock dictation={voice} />);
    const mic = screen.getByRole('button', { name: '音声で入力する' });
    expect(mic.getAttribute('aria-pressed')).toBe('false');

    await user.click(mic);
    const dock = document.querySelector('.astra-dock') as HTMLElement;
    expect(dock.dataset['state']).toBe('LISTENING');
    expect(dock.dataset['geometry']).toBe('listening');
    expect(
      screen.getByRole('button', { name: '音声入力を止める' }).getAttribute('aria-pressed'),
    ).toBe('true');
  });

  it('keeps typed text while listening rather than switching modes (§1.2 No Mode)', async () => {
    const user = userEvent.setup();
    render(<TaskDock dictation={voice} />);
    const field = screen.getByLabelText('依頼を入力') as HTMLTextAreaElement;
    await user.type(field, '途中まで');
    await user.click(screen.getByRole('button', { name: '音声で入力する' }));
    expect(field.value).toBe('途中まで');
  });
});

describe('escape (§4.4)', () => {
  it('shrinks on the first press and dismisses on the second', async () => {
    const user = userEvent.setup();
    render(<TaskDock />);
    const field = screen.getByLabelText('依頼を入力');
    const dock = document.querySelector('.astra-dock') as HTMLElement;

    await user.type(field, '何か');
    await user.type(field, '{Escape}');
    expect(dock.dataset['state']).toBe('MINIMIZED');

    await user.type(field, '{Escape}');
    expect(dock.dataset['state']).toBe('HIDDEN');
  });

  it('collapses an open context lens before dismissing anything', async () => {
    const user = userEvent.setup();
    render(
      <TaskDock
        initialSources={[
          source({ id: 'a', label: 'A社' }),
          source({ id: 'b', label: 'Q4提案.pptx' }),
          source({ id: 'c', label: '明日 10:00' }),
          source({ id: 'd', label: '関連メール8件' }),
        ]}
      />,
    );
    await user.click(screen.getByText('+1'));
    expect(screen.getByRole('button', { name: '関連メール8件 を外す' })).toBeTruthy();

    await user.type(screen.getByLabelText('依頼を入力'), '{Escape}');
    // 先に畳む。いきなり消さない。
    expect(screen.queryByRole('button', { name: '関連メール8件 を外す' })).toBeNull();
    expect((document.querySelector('.astra-dock') as HTMLElement).dataset['state']).toBe('READY');
  });
});

describe('keyboard (§20)', () => {
  /** §20 の表は OS ごとに違う。どちらの OS の話をしているかを固定する。 */
  const onPlatform = (userAgent: string): void => {
    Object.defineProperty(window.navigator, 'userAgent', {
      configurable: true,
      value: userAgent,
    });
  };
  const MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)';
  const WINDOWS = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)';

  it('does not send while the IME is still converting', async () => {
    const send = vi.fn(async () => ({ needsClarification: false, answer: null }));
    render(<TaskDock conversation={{ send }} />);
    const field = screen.getByLabelText('依頼を入力') as HTMLTextAreaElement;

    await userEvent.type(field, 'かいぎ');
    // 変換確定の Enter。**これは送信ではない。**
    fireEvent.keyDown(field, { key: 'Enter', code: 'Enter', isComposing: true });
    expect(send).not.toHaveBeenCalled();
    expect(field.value).toBe('かいぎ');

    // 確定したあとの Enter で初めて送る
    fireEvent.keyDown(field, { key: 'Enter', code: 'Enter' });
    await waitFor(() => expect(send).toHaveBeenCalledWith('かいぎ', []));
  });

  it('takes Esc even when the focus is not in the input', async () => {
    render(<TaskDock initialSources={[source({ id: 'a', label: 'A社' })]} />);
    const dock = document.querySelector('.astra-dock') as HTMLElement;
    // 入力欄から focus を外す。承認ボタン等にいる状況。
    (screen.getByRole('button', { name: '音声で入力する' }) as HTMLElement).focus();

    fireEvent.keyDown(window, { key: 'Escape', code: 'Escape' });
    expect(dock.dataset['state']).toBe('HIDDEN');
  });

  it('opens the Context Lens with the shortcut the spec names', async () => {
    onPlatform(MAC);
    render(
      <TaskDock
        initialSources={[
          source({ id: 'a', label: 'A社' }),
          source({ id: 'b', label: 'Q4提案.pptx' }),
          source({ id: 'c', label: '明日 10:00' }),
          source({ id: 'd', label: '関連メール8件' }),
        ]}
      />,
    );
    expect(screen.queryByRole('button', { name: '関連メール8件 を外す' })).toBeNull();

    // §20: macOS は Cmd+Shift+C
    fireEvent.keyDown(window, { key: 'C', code: 'KeyC', metaKey: true, shiftKey: true });
    expect(screen.getByRole('button', { name: '関連メール8件 を外す' })).toBeTruthy();
    cleanup();

    // Windows は Ctrl+Shift+C。Cmd 相当を押しても効かない。
    onPlatform(WINDOWS);
    render(
      <TaskDock
        initialSources={[
          source({ id: 'a', label: 'A社' }),
          source({ id: 'b', label: 'Q4提案.pptx' }),
          source({ id: 'c', label: '明日 10:00' }),
          source({ id: 'd', label: '関連メール8件' }),
        ]}
      />,
    );
    fireEvent.keyDown(window, { key: 'C', code: 'KeyC', metaKey: true, shiftKey: true });
    expect(screen.queryByRole('button', { name: '関連メール8件 を外す' })).toBeNull();
    fireEvent.keyDown(window, { key: 'C', code: 'KeyC', ctrlKey: true, shiftKey: true });
    expect(screen.getByRole('button', { name: '関連メール8件 を外す' })).toBeTruthy();
  });

  it('follows a shortcut the user changed in Settings', async () => {
    onPlatform(MAC);
    render(
      <TaskDock
        initialSources={[
          source({ id: 'a', label: 'A社' }),
          source({ id: 'b', label: 'Q4提案.pptx' }),
          source({ id: 'c', label: '明日 10:00' }),
          source({ id: 'd', label: '関連メール8件' }),
        ]}
        shortcutOverrides={{
          'context.open': {
            code: 'KeyK',
            modifiers: { primary: true, alt: false, shift: true, control: false },
          },
        }}
      />,
    );
    // 既定は、変更したあとは効かない
    fireEvent.keyDown(window, { key: 'C', code: 'KeyC', metaKey: true, shiftKey: true });
    expect(screen.queryByRole('button', { name: '関連メール8件 を外す' })).toBeNull();

    fireEvent.keyDown(window, { key: 'K', code: 'KeyK', metaKey: true, shiftKey: true });
    expect(screen.getByRole('button', { name: '関連メール8件 を外す' })).toBeTruthy();
  });
});

describe('what the dock actually sends (正本 §6)', () => {
  it('sends the context it is showing, so the first sentence is not questioned', async () => {
    const send = vi.fn(async () => ({ needsClarification: false, answer: null }));
    render(
      <TaskDock
        conversation={{ send }}
        initialSources={[
          source({ id: 'a', label: 'Example Inc', category: 'current' }),
          source({ id: 'b', label: 'Q4提案.pptx', category: 'internal' }),
        ]}
      />,
    );

    await userEvent.type(screen.getByLabelText('依頼を入力'), 'この会社について調べて{Enter}');
    // 画面に出しておきながら送らないのは、出していないのと同じ
    await waitFor(() =>
      expect(send).toHaveBeenCalledWith('この会社について調べて', [
        { label: 'Example Inc', kind: 'current' },
        { label: 'Q4提案.pptx', kind: 'internal' },
      ]),
    );
  });

  it('stops sending a source the user removed', async () => {
    const send = vi.fn(async () => ({ needsClarification: false, answer: null }));
    render(
      <TaskDock
        conversation={{ send }}
        initialSources={[
          source({ id: 'a', label: 'Example Inc', category: 'current' }),
          source({ id: 'b', label: 'Q4提案.pptx', category: 'internal' }),
        ]}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Q4提案.pptx を外す' }));
    await userEvent.type(screen.getByLabelText('依頼を入力'), '調べて{Enter}');

    await waitFor(() =>
      expect(send).toHaveBeenCalledWith('調べて', [{ label: 'Example Inc', kind: 'current' }]),
    );
  });
});

describe('push-to-talk (§20)', () => {
  it('listens while the key is held and stops the moment it is released', async () => {
    let fire: ((id: string, pressed: boolean) => void) | null = null;
    const unlisten = vi.fn();
    vi.spyOn(shortcuts, 'onHold').mockImplementation(async (handler) => {
      fire = handler;
      return unlisten;
    });
    const stop = vi.fn(async () => undefined);
    const dictation = { start: vi.fn(async () => undefined), stop };

    const { unmount } = render(<TaskDock dictation={dictation} />);
    const dock = document.querySelector('.astra-dock') as HTMLElement;
    await waitFor(() => expect(fire).not.toBeNull());

    act(() => fire!('dock.pushToTalk', true));
    expect(dock.dataset['state']).toBe('LISTENING');

    // **離したら必ず止める。**押していないのに録り続けない。
    act(() => fire!('dock.pushToTalk', false));
    expect(dock.dataset['state']).toBe('READY');
    expect(stop).toHaveBeenCalled();

    // 別のショートカットの hold には反応しない
    act(() => fire!('dock.toggle', true));
    expect(dock.dataset['state']).toBe('READY');

    unmount();
    expect(unlisten).toHaveBeenCalled();
  });
});

describe('context lens (§5)', () => {
  const four = [
    source({ id: 'a', label: 'Q4提案.pptx', category: 'current', used: true }),
    source({ id: 'b', label: 'A社', category: 'entity' }),
    source({ id: 'c', label: '明日 10:00', category: 'schedule' }),
    source({ id: 'd', label: '関連メール8件', category: 'internal' }),
  ];

  it('shows three chips and counts the rest (§4.3)', () => {
    render(<TaskDock initialSources={four} />);
    expect(screen.getByText('+1')).toBeTruthy();
    expect(screen.queryByText('関連メール8件')).toBeNull();
  });

  it('expands to everything and folds back', async () => {
    const user = userEvent.setup();
    render(<TaskDock initialSources={four} />);
    await user.click(screen.getByText('+1'));
    expect(screen.getByText('関連メール8件')).toBeTruthy();

    await user.click(screen.getByRole('button', { name: '情報を折りたたむ' }));
    expect(screen.queryByText('関連メール8件')).toBeNull();
  });

  it('lets the user remove a source', async () => {
    const user = userEvent.setup();
    render(<TaskDock initialSources={four} />);
    expect(screen.getByText('A社')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'A社 を外す' }));
    expect(screen.queryByText('A社')).toBeNull();
  });

  it('explains a source one level deep, without exposing model reasoning', async () => {
    const user = userEvent.setup();
    render(
      <TaskDock
        initialSources={[source({ id: 'a', label: 'A社', reason: '明日の商談相手のため' })]}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'A社 を使う理由' }));
    expect(screen.getByText('明日の商談相手のため')).toBeTruthy();
  });

  it('offers no remove button for a source that cannot be removed', () => {
    render(
      <TaskDock initialSources={[source({ id: 'p', label: 'Confidential', removable: false })]} />,
    );
    expect(screen.queryByRole('button', { name: 'Confidential を外す' })).toBeNull();
  });

  it('labels sensitive sources in text, not colour alone (§5.2)', () => {
    render(
      <TaskDock
        initialSources={[source({ id: 's', label: '患者記録', sensitivity: 'REGULATED' })]}
      />,
    );
    expect(screen.getByText('REGULATED')).toBeTruthy();
  });

  it('shows nothing at all when there is no context', () => {
    render(<TaskDock />);
    expect(document.querySelector('.astra-context')).toBeNull();
  });

  it('puts what was actually used first', async () => {
    render(<TaskDock initialSources={four} />);
    await waitFor(() => {
      const labels = [...document.querySelectorAll('.astra-chip__label')].map((n) => n.textContent);
      expect(labels[0]).toBe('Q4提案.pptx');
    });
  });
});

describe('work surface inside the dock (§4.4 / §6)', () => {
  const view = {
    title: 'A社 商談準備',
    status: 'WAITING_APPROVAL' as const,
    steps: [
      {
        index: 0,
        state: 'done' as const,
        label: '関連情報を確認',
        detail: null,
        startedAt: '2026-08-27T04:00:00.000Z',
        endedAt: '2026-08-27T04:00:05.000Z',
      },
      {
        index: 1,
        state: 'active' as const,
        label: '競合情報を調査中',
        detail: '12 sources',
        startedAt: '2026-08-27T04:00:05.000Z',
        endedAt: null,
      },
    ],
    percent: 50,
    attention: {
      kind: 'approval' as const,
      approvalId: 'ap-1',
      summary: '3人にメールを送信します',
      primaryActionLabel: '3件送信する',
      expiresAt: new Date().toISOString(),
    },
    resultArtifactId: null,
    error: null,
    elapsedMs: 12_000,
    startedAt: '2026-08-27T04:00:00.000Z',
    endedAt: null,
    pausedReason: null,
    lastSequence: 5,
  };

  it('keeps the progress inside the dock instead of pushing to the full app', async () => {
    const user = userEvent.setup();
    render(<TaskDock work={view} />);
    // working 面へ移るには対話状態も進んでいる必要がある
    await user.type(screen.getByLabelText('依頼を入力'), '商談準備して{Enter}');

    expect(screen.getByText('A社 商談準備')).toBeTruthy();
    expect(screen.getByText('12 sources')).toBeTruthy();
    expect((document.querySelector('.astra-dock') as HTMLElement).dataset['geometry']).toBe(
      'working',
    );
  });

  it('offers the workspace only as an explicit next step', async () => {
    const onOpenWorkspace = vi.fn();
    const user = userEvent.setup();
    render(<TaskDock work={view} onOpenWorkspace={onOpenWorkspace} />);
    await user.type(screen.getByLabelText('依頼を入力'), 'x{Enter}');

    await user.click(screen.getByRole('button', { name: '詳しく見る' }));
    expect(onOpenWorkspace).toHaveBeenCalled();
  });

  it('does not show the work card while still in the ready state', () => {
    render(<TaskDock work={view} />);
    expect(screen.queryByText('A社 商談準備')).toBeNull();
  });
});

describe('the dock talking to the Conversation Engine (Phase 7)', () => {
  const conversation = (
    result: { needsClarification: boolean; answer: string | null } | Error,
  ) => ({
    send: vi.fn(async () => {
      if (result instanceof Error) throw result;
      return result;
    }),
  });

  it('asks back instead of starting work it cannot pin down', async () => {
    // 進めると、利用者が指したものとは別のものに対して動く（D-49）
    const engine = conversation({
      needsClarification: true,
      answer: '「それ」がどれを指すか分かりませんでした。',
    });
    render(<TaskDock conversation={engine} />);

    await userEvent.type(screen.getByRole('textbox'), 'それを共有して');
    await userEvent.keyboard('{Enter}');

    expect((await screen.findByRole('alert')).textContent).toContain('それ');
    // 入力は消さない。言い直せるようにしておく。
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('それを共有して');
  });

  it('clears the box and gets to work once it understood', async () => {
    const engine = conversation({ needsClarification: false, answer: null });
    render(<TaskDock conversation={engine} />);

    await userEvent.type(screen.getByRole('textbox'), '競合を調べて');
    await userEvent.keyboard('{Enter}');

    await waitFor(() =>
      expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe(''),
    );
    expect(engine.send).toHaveBeenCalledWith('競合を調べて', []);
  });

  it('says what went wrong rather than going quiet', async () => {
    const engine = conversation(new Error('接続できませんでした'));
    render(<TaskDock conversation={engine} />);

    await userEvent.type(screen.getByRole('textbox'), '何か');
    await userEvent.keyboard('{Enter}');

    expect((await screen.findByRole('alert')).textContent).toContain('接続できませんでした');
  });
});

describe('the dock taking voice (正本 §11.1)', () => {
  const dictation = () => {
    let handlers: { onPartial(t: string): void; onFinal(t: string): void } | null = null;
    return {
      start: vi.fn(async (h: typeof handlers) => {
        handlers = h;
      }),
      stop: vi.fn(async () => {}),
      say: (text: string, final = false) =>
        final ? handlers?.onFinal(text) : handlers?.onPartial(text),
    };
  };

  it('shows what it heard while it is still hearing it', async () => {
    const voice = dictation();
    render(<TaskDock dictation={voice} />);

    await userEvent.click(screen.getByRole('button', { name: '音声で入力する' }));
    await waitFor(() => expect(voice.start).toHaveBeenCalled());

    act(() => voice.say('競合を'));
    await waitFor(() =>
      expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('競合を'),
    );

    // 確定したら入れ替わる
    act(() => voice.say('競合を調べて', true));
    await waitFor(() =>
      expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('競合を調べて'),
    );
  });

  it('says so when it could not listen at all', async () => {
    const broken = {
      start: vi.fn(async () => {
        throw new Error('マイクを使えません');
      }),
      stop: vi.fn(async () => {}),
    };
    render(<TaskDock dictation={broken} />);
    await userEvent.click(screen.getByRole('button', { name: '音声で入力する' }));
    expect((await screen.findByRole('alert')).textContent).toContain('マイクを使えません');
  });
});

describe('honesty about what the dock can do (§21・§25)', () => {
  it('does not pretend to listen when no voice input is wired', async () => {
    /*
     * LISTENING に入って何も起きないと、利用者は喋り続けて待つことになる。
     * できないことは、できないと言う。
     */
    const user = userEvent.setup();
    render(<TaskDock />);
    await user.click(screen.getByRole('button', { name: '音声で入力する' }));
    expect(screen.getByRole('alert').textContent).toContain('音声入力はこの端末ではまだ使えません');
    // 聞いているふりの状態には入っていない
    expect(screen.queryByText('聞いています')).toBeNull();
  });

  it('opens a menu of things to attach, instead of doing nothing', async () => {
    // §4.3: Attach + = File / Screen / Selection。押しても何も起きない + が残っていた
    const user = userEvent.setup();
    render(<TaskDock />);
    await user.click(screen.getByRole('button', { name: 'ファイルや画面を追加する' }));
    const menu = screen.getByRole('menu', { name: '何を添えるか' });
    expect(
      within(menu)
        .getAllByRole('menuitem')
        .map((m) => m.textContent),
    ).toEqual(['ファイル', 'いまの画面', '選択しているもの']);
    // 技術的な tool 名は出さない
    expect(document.body.textContent).not.toMatch(/MCP|connector|tool/i);
  });
});

describe('the Orb is the entry (Deepgram floating-orb)', () => {
  it('shows the Orb while idle and starts listening when pressed', async () => {
    const user = userEvent.setup();
    render(<TaskDock dictation={voice} />);
    const orb = screen.getByRole('button', { name: 'Astra に話しかける' });
    expect(orb.getAttribute('data-astra-voice-state')).toBe('idle');
    await user.click(orb);
    expect(
      screen.getByRole('button', { name: '聞くのをやめる' }).getAttribute('aria-pressed'),
    ).toBe('true');
  });

  it('draws the microphone as an icon, not an emoji', () => {
    render(<TaskDock />);
    const mic = screen.getByRole('button', { name: '音声で入力する' });
    expect(mic.querySelector('svg.astra-mic-icon')).not.toBeNull();
    expect(mic.textContent).not.toContain('🎙');
  });
});

describe('Esc while listening (§4.4, privacy)', () => {
  it('stops the microphone before it folds the Dock', async () => {
    const user = userEvent.setup();
    const stop = vi.fn(async () => {});
    render(<TaskDock dictation={{ async start() {}, stop }} />);
    await user.click(screen.getByRole('button', { name: 'Astra に話しかける' }));
    const dock = screen.getByLabelText('依頼を入力').closest('.astra-dock') as HTMLElement;
    expect(dock.dataset['state']).toBe('LISTENING');
    await user.keyboard('{Escape}');
    expect(stop).toHaveBeenCalledTimes(1);
    expect(dock.dataset['state']).not.toBe('LISTENING');
  });
});
