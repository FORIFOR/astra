/**
 * Task Dock と Context Lens。UI-1。
 * UI/UX §3・§4.3・§4.4・§5。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import type { ContextSource } from '@astra/contracts';
import { TaskDock } from '../src/dock/TaskDock.js';

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

afterEach(cleanup);

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
    expect(screen.getByRole('status').textContent).toBe('文脈を確認しています');
  });
});

describe('voice (§4.3)', () => {
  it('toggles listening and shows it in an accessible way', async () => {
    const user = userEvent.setup();
    render(<TaskDock />);
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
    render(<TaskDock />);
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
      { index: 0, state: 'done' as const, label: '関連情報を確認', detail: null },
      { index: 1, state: 'active' as const, label: '競合情報を調査中', detail: '12 sources' },
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
    expect(engine.send).toHaveBeenCalledWith('競合を調べて');
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
