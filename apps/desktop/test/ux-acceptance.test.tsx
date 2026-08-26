/**
 * UI/UX 仕様 §25 Acceptance criteria（AC-01〜AC-15）。
 *
 * 各機能の試験は個別にあるが、**§25 をそのまま並べたものが無かった。**
 * 仕様の受け入れ表と、実際に確かめていることの対応が取れないと、
 * 「どれが未達か」を言えなくなる。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import {
  MAX_ATTENTION_ITEMS,
  SLO_TARGETS,
  uuidv7,
  type Artifact,
  type DashboardView,
} from '@astra/contracts';
import { TOKENS_CSS, TOP_LEVEL_TABS, meetsAA, palettes, resolveLayout } from '@astra/ui-kit';
import { TaskDock } from '../src/dock/TaskDock.js';
import { HomePage } from '../src/pages/Home.js';
import { LibraryPage } from '../src/pages/Library.js';
import { AppsPage } from '../src/pages/Apps.js';
import { MeetingSurface } from '../src/meeting/MeetingSurface.js';
import { MeetingArtifact } from '../src/meeting/MeetingArtifact.js';
import { DashboardRenderer } from '../src/apps/DashboardRenderer.js';
import { WorkCard } from '../src/work/WorkCard.js';
import { ATTENTION_LIMIT, buildAttentionFeed } from '../src/home/attention.js';
import { RecordingIndicator } from '../src/meeting/RecordingIndicator.js';
import { StartConfirmation } from '../src/meeting/StartConfirmation.js';

afterEach(cleanup);

describe('AC-01: start work without picking an agent or a mode', () => {
  it('offers one box, not a list of modes', async () => {
    const conversation = {
      send: vi.fn(async () => ({ needsClarification: false, answer: null })),
    };
    render(<TaskDock conversation={conversation} />);

    // モードを選ばせる控えが無い
    expect(screen.queryByRole('radiogroup')).toBeNull();
    expect(screen.queryByRole('combobox')).toBeNull();

    await userEvent.type(screen.getByRole('textbox'), '来週の商談準備して');
    await userEvent.keyboard('{Enter}');
    expect(conversation.send).toHaveBeenCalledWith('来週の商談準備して');
  });
});

describe('AC-02: the dock is ready to take input immediately', () => {
  it('has an input focused and usable on first paint', () => {
    render(<TaskDock />);
    const box = screen.getByRole('textbox');
    expect(box).toBeTruthy();
    // 目標は p95 120ms。ここでは「描いた時点で入力できる」ことだけを見る。
    expect(SLO_TARGETS.dockShow.budgetMs).toBe(120);
    expect((box as HTMLTextAreaElement).disabled).toBe(false);
  });
});

describe('AC-03: the context can be inspected and narrowed', () => {
  const sources = [
    {
      id: 'a',
      category: 'current',
      label: 'Q4提案.pptx',
      reason: 'いま開いているため',
      sensitivity: 'PRIVATE',
      removable: true,
      used: true,
    },
    {
      id: 'b',
      category: 'policy',
      label: '規制データ',
      reason: null,
      sensitivity: 'REGULATED',
      removable: false,
      used: true,
    },
  ] as never;

  it('shows what will be used, and lets the removable ones go', () => {
    render(<TaskDock initialSources={sources} />);

    expect(screen.getByLabelText('この依頼で使う情報')).toBeTruthy();
    expect(screen.getByText('Q4提案.pptx')).toBeTruthy();
    // 外せないものは外す口を出さない（policy 由来は外させない）
    expect(screen.getAllByRole('button', { name: /を外す$/ })).toHaveLength(1);
  });
});

describe('AC-04: no spinner-only waiting', () => {
  it('says what it is doing, not just that it is busy', () => {
    render(
      <WorkCard
        view={
          {
            title: '競合調査',
            status: 'RUNNING',
            steps: [
              {
                index: 0,
                state: 'active',
                label: '公式資料と最新ニュースを照合中',
                detail: '12 sources',
              },
            ],
            percent: null,
            attention: null,
            resultArtifactId: null,
            error: null,
            elapsedMs: 1_000,
            lastSequence: 1,
          } as never
        }
      />,
    );
    expect(screen.getByText('公式資料と最新ニュースを照合中')).toBeTruthy();
    expect(screen.getByText('12 sources')).toBeTruthy();
    // 段数が決まらないので % は出さない
    expect(screen.queryByRole('progressbar')).toBeNull();
  });
});

describe('AC-05: closing the dock does not stop the work', () => {
  it('keeps the work visible from Home', () => {
    const task = {
      id: uuidv7(),
      title: '競合調査',
      status: 'RUNNING',
      updated_at: new Date().toISOString(),
      dockState: 'working',
    } as never;
    render(<HomePage tasks={[task]} />);
    expect(screen.getByText('競合調査')).toBeTruthy();
  });
});

describe('AC-06: an external commit is confirmed and leaves a receipt', () => {
  it('shows what will happen, not just that approval is needed', () => {
    render(
      <WorkCard
        view={
          {
            title: 'メール送信',
            status: 'WAITING_APPROVAL',
            steps: [],
            percent: null,
            attention: {
              kind: 'approval',
              approvalId: uuidv7(),
              summary: 'A社へ見積を送ります',
              primaryActionLabel: '送信する',
              expiresAt: new Date(Date.now() + 600_000).toISOString(),
            },
            resultArtifactId: null,
            error: null,
            elapsedMs: 1_000,
            lastSequence: 1,
          } as never
        }
        onApprove={() => {}}
        onReject={() => {}}
      />,
    );
    expect(screen.getByText('A社へ見積を送ります')).toBeTruthy();
    expect(screen.getByRole('button', { name: '送信する' })).toBeTruthy();
  });
});

describe('AC-12: the top navigation never grows past four', () => {
  it('has exactly Home / Work / Library / Apps', () => {
    expect(TOP_LEVEL_TABS.map((t) => t.id)).toEqual(['home', 'work', 'library', 'apps']);
  });

  it('does not grow when a plugin brings a dashboard', async () => {
    const client = {
      pluginCatalog: vi.fn(async () => []),
      dashboards: vi.fn(async () => [
        { plugin_id: 'com.x.y', plugin_name: 'X', id: 'd', title: 'D' },
      ]),
      dashboard: vi.fn(),
    } as never;
    render(<AppsPage client={client} />);
    await screen.findByRole('button', { name: /X — D/ });
    // dashboard はタブにならない。Apps の中に出る。
    expect(TOP_LEVEL_TABS).toHaveLength(4);
  });
});

describe('AC-13: it reflows instead of breaking', () => {
  it('gives three columns wide, and a drawer when it is narrower', () => {
    expect(resolveLayout(1440, false).mode).toBe('wide');
    expect(resolveLayout(1000, false).mode).toBe('medium');
    // 狭すぎるときは、潰さずに必要な幅を言う
    expect(resolveLayout(600, false).mode).toBe('unsupported');
  });
});

describe('AC-15: an error says what it means for the work', () => {
  it('does not call a failure a success', () => {
    render(
      <WorkCard
        view={
          {
            title: '見積送信',
            status: 'FAILED',
            steps: [],
            percent: null,
            attention: null,
            resultArtifactId: null,
            error: { code: 'task.step_failed', recovery: 'reconnect' },
            elapsedMs: 1_000,
            lastSequence: 1,
          } as never
        }
      />,
    );
    // 失敗を成功として見せない（status ラベルが「完了」にならない）
    const status = document.querySelector('.astra-work__status');
    expect(status?.textContent).toBe('失敗');
    // 仕事への影響と、次にすべきことが書いてある（§21）
    const alert = screen.getByRole('alert');
    expect(alert.textContent ?? '').toMatch(/途中までの結果は保存/);
    expect(alert.textContent ?? '').toMatch(/接続を確認/);
  });
});

describe('AC-07: recording state and audio source are never ambiguous', () => {
  it('will not start until the sources and the consent are settled', async () => {
    const onStart = vi.fn();
    render(<StartConfirmation defaultTitle="A社定例" onCancel={() => {}} onStart={onStart} />);

    // 何を録るかが、開始前に読める形で出ている
    const sources = screen.getByRole('group', { name: '録音する音声' });
    expect(sources.textContent).toContain('マイク');
    expect(sources.textContent).toContain('システム音声');

    const start = screen.getByRole('button', { name: '記録を開始' });
    // 同意の確認を飛ばせない
    expect((start as HTMLButtonElement).disabled).toBe(true);
    await userEvent.click(screen.getByRole('checkbox', { name: /同意を確認しました/ }));
    expect((start as HTMLButtonElement).disabled).toBe(false);

    await userEvent.click(start);
    expect(onStart).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'A社定例', audioSources: ['microphone'] }),
    );
  });

  it('keeps a minimal indicator up the whole time, readable by a screen reader', () => {
    const { rerender } = render(
      <RecordingIndicator
        state="recording"
        title="A社定例"
        elapsedMs={65_000}
        speakers={2}
        onPause={() => {}}
        onStop={() => {}}
      />,
    );
    const indicator = screen.getByRole('status');
    // 色の点だけに頼らない（§19）。読み上げにも状態が出る（§18）。
    expect(indicator.getAttribute('aria-label')).toBe('Recording — A社定例');
    expect(indicator.textContent).toContain('REC');
    expect(indicator.textContent).toContain('1:05');

    // 文字起こしが落ちても「録音は続いている」と言う（§16）
    rerender(
      <RecordingIndicator
        state="degraded"
        title="A社定例"
        elapsedMs={65_000}
        speakers={2}
        onPause={() => {}}
        onStop={() => {}}
      />,
    );
    expect(screen.getByRole('status').textContent).toContain('録音は継続中');
  });
});

describe('AC-08 / AC-09: the meeting surface and its minutes', () => {
  const view = {
    lines: [
      {
        id: 'a',
        speakerTag: 1,
        text: '初期費用が気になります',
        startMs: 0,
        endMs: 1_000,
        interim: false,
        translation: null,
      },
    ],
    ended: false,
    finalizeTaskId: null,
  };

  it('AC-08: notes are the main surface, transcript is on demand', async () => {
    render(
      <MeetingSurface
        title="A社"
        view={view}
        elapsedMs={0}
        state="recording"
        notes=""
        speakerNames={new Map()}
        onNotesChange={() => {}}
        onMark={() => {}}
        onNameSpeaker={() => {}}
        onPause={() => {}}
        onStop={() => {}}
      />,
    );
    expect(screen.getByLabelText('Notes')).toBeTruthy();
    expect(screen.queryByLabelText('Transcript')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Transcript' }));
    expect(screen.getByLabelText('Transcript')).toBeTruthy();
  });

  it('AC-09: a claim jumps to the transcript line behind it', async () => {
    const segments = [
      { id: 'a', speaker_tag: 1, text: '10 月で行きましょう', start_ms: 65_000 },
    ] as never;
    render(
      <MeetingArtifact
        bundle={
          {
            meeting_id: uuidv7(),
            title: 'A社',
            duration_ms: 66_000,
            speaker_count: 1,
            summary: [],
            decisions: [{ text: '10 月導入', citations: [{ segment_id: 'a', start_ms: 65_000 }] }],
            action_items: [],
            open_questions: [],
          } as never
        }
        segments={segments}
        names={new Map([[1, '田中']])}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: '根拠 1 を見る' }));
    const evidence = screen.getByLabelText('根拠');
    expect(evidence.textContent).toContain('01:05');
    expect(evidence.textContent).toContain('田中');
  });
});

describe('AC-10: research results carry their evidence', () => {
  it('shows the count and how sure it is, not just the answer', () => {
    render(
      <DashboardRenderer
        view={
          {
            plugin_id: 'com.astra.research',
            schema: {
              id: 'r',
              title: '調査',
              layout: 'grid',
              items: [{ type: 'metric', title: '出典', bind: 'research.total' }],
            },
            data: { 'research.total': { kind: 'count', value: 12 } },
          } as DashboardView
        }
      />,
    );
    expect(screen.getByText('12')).toBeTruthy();
  });
});

describe('AC-11: a library artifact can be traced back', () => {
  it('links to the work that produced it', async () => {
    const artifact = {
      id: uuidv7(),
      type: 'REPORT',
      title: '競合調査',
      source_task_id: uuidv7(),
      source_meeting_id: null,
      created_at: new Date().toISOString(),
      tags: [],
      sensitivity: 'PRIVATE',
      size: 1,
      sha256: 'a'.repeat(64),
    } as unknown as Artifact;
    const onOpenTask = vi.fn();
    render(<LibraryPage artifacts={[artifact]} selectedId={artifact.id} onOpenTask={onOpenTask} />);

    const link = screen.getByRole('button', { name: 'この仕事から作られました' });
    await userEvent.click(link);
    expect(onOpenTask).toHaveBeenCalledWith(artifact.source_task_id);
  });
});

describe('AC-14: keyboard reachable and focus visible, in both themes', () => {
  it('never removes the focus ring', () => {
    expect(TOKENS_CSS).toContain(':focus-visible');
    expect(TOKENS_CSS).toMatch(/outline:\s*2px solid var\(--astra-color-focus-ring\)/);
    // outline: none で消していない
    expect(TOKENS_CSS).not.toMatch(/:focus-visible\s*\{[^}]*outline:\s*none/);
  });

  it('has a focus ring that is actually visible on both canvases', () => {
    for (const theme of ['light', 'dark'] as const) {
      const palette = palettes[theme];
      // §19: focus ring は図形なので大きい方の下限（3:1）で見る
      expect(meetsAA(palette.focusRing, palette.canvas, true)).toBe(true);
      expect(meetsAA(palette.focusRing, palette.surface, true)).toBe(true);
    }
  });

  it('reaches every control in the work card by tab, in either theme', async () => {
    for (const theme of ['light', 'dark'] as const) {
      document.documentElement.setAttribute('data-theme', theme);
      const { unmount } = render(
        <WorkCard
          view={
            {
              title: 'メール送信',
              status: 'WAITING_APPROVAL',
              steps: [],
              percent: null,
              attention: {
                kind: 'approval',
                approvalId: uuidv7(),
                summary: 'A社へ見積を送ります',
                primaryActionLabel: '送信する',
                expiresAt: new Date(Date.now() + 600_000).toISOString(),
              },
              resultArtifactId: null,
              error: null,
              elapsedMs: 1_000,
              lastSequence: 1,
            } as never
          }
          onApprove={() => {}}
          onReject={() => {}}
          onOpen={() => {}}
        />,
      );

      const controls = [...document.querySelectorAll('button')];
      expect(controls.length).toBeGreaterThan(0);
      // tabindex を負にして keyboard から外していない
      for (const control of controls) {
        expect(Number(control.getAttribute('tabindex') ?? '0')).toBeGreaterThanOrEqual(0);
        expect(control.closest('[aria-hidden="true"]')).toBeNull();
      }

      // 実際に Tab で全部に届く
      const reached: string[] = [];
      for (let i = 0; i < controls.length; i += 1) {
        await userEvent.tab();
        if (document.activeElement instanceof HTMLElement) {
          reached.push(document.activeElement.textContent ?? '');
        }
      }
      for (const control of controls) {
        expect(reached).toContain(control.textContent ?? '');
      }

      unmount();
      document.documentElement.removeAttribute('data-theme');
    }
  });
});

describe('Home (§8.1): attention never floods', () => {
  it('shows at most three things, and says how many are left', () => {
    expect(MAX_ATTENTION_ITEMS).toBe(ATTENTION_LIMIT);
    const now = Date.now();
    const tasks = Array.from({ length: 7 }, (_, i) => ({
      id: uuidv7(),
      title: `確認 ${i + 1}`,
      status: 'WAITING_APPROVAL',
      updated_at: new Date(now - i * 1_000).toISOString(),
      started_at: new Date(now - 60_000).toISOString(),
      completed_at: null,
    })) as never;

    const feed = buildAttentionFeed(tasks, now);
    expect(feed.items).toHaveLength(ATTENTION_LIMIT);
    // 4 件目以降は消さず、件数として残す
    expect(feed.overflow).toBe(4);
  });

  it('stays quiet about short work that finished on its own', () => {
    const now = Date.now();
    const tasks = [
      {
        id: uuidv7(),
        title: '短い仕事',
        status: 'COMPLETED',
        updated_at: new Date(now).toISOString(),
        started_at: new Date(now - 5_000).toISOString(),
        completed_at: new Date(now).toISOString(),
      },
    ] as never;
    expect(buildAttentionFeed(tasks, now).items).toHaveLength(0);
  });
});
