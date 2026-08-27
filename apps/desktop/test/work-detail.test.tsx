/**
 * Work detail。UI/UX §9.2。
 *
 * §9.2 は 5 つの tab を要求している。
 * **中身が無い tab を消さない。**消すと「根拠が無い仕事」なのか
 * 「まだ作っていない」のかを、利用者が区別できない。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { uuidv7, type Artifact, type ContextSource } from '@astra/contracts';
import { WORK_DETAIL_TABS, WorkDetail, activityLines, nextStep } from '../src/work/WorkDetail.js';
import type { WorkView } from '../src/work/workView.js';

afterEach(cleanup);

const TASK = uuidv7();

const view = (over: Partial<WorkView> = {}): WorkView =>
  ({
    title: 'A社 商談準備',
    status: 'RUNNING',
    steps: [
      {
        index: 0,
        state: 'done',
        label: '関連情報を確認',
        detail: null,
        startedAt: '2026-08-27T04:00:00.000Z',
        endedAt: '2026-08-27T04:01:00.000Z',
      },
      {
        index: 1,
        state: 'active',
        label: '競合情報を調査中',
        detail: '12 sources',
        startedAt: '2026-08-27T04:01:00.000Z',
        endedAt: null,
      },
    ],
    percent: 50,
    attention: null,
    resultArtifactId: null,
    error: null,
    elapsedMs: 90_000,
    startedAt: '2026-08-27T04:00:00.000Z',
    endedAt: null,
    lastSequence: 4,
    ...over,
  }) as WorkView;

const artifact = (over: Partial<Artifact> = {}): Artifact =>
  ({
    id: uuidv7(),
    tenant_id: uuidv7(),
    owner_id: uuidv7(),
    type: 'REPORT',
    title: '競合レポート',
    mime_type: 'text/markdown',
    size: 10,
    version: 1,
    source_task_id: TASK,
    parent_artifact_id: null,
    tags: [],
    sensitivity: 'PRIVATE',
    created_at: '2026-08-27T04:02:00.000Z',
    updated_at: '2026-08-27T04:02:00.000Z',
    ...over,
  }) as Artifact;

const clientWith = (artifacts: Artifact[], evidence?: unknown) =>
  ({
    listArtifacts: vi.fn(async () => ({ items: artifacts, nextCursor: null })),
    taskReceipts: vi.fn(async () => []),
    taskEvidence: vi.fn(async () => {
      // 調査でない仕事は 404。空の台帳を返さない。
      if (evidence === undefined) throw new Error('common.not_found');
      return evidence;
    }),
  }) as never;

describe('the five tabs the spec names', () => {
  it('offers exactly Overview / Progress / Outputs / Evidence / Activity', () => {
    expect(WORK_DETAIL_TABS.map((t) => t.id)).toEqual([
      'overview',
      'progress',
      'outputs',
      'evidence',
      'activity',
    ]);
  });

  it('keeps every tab reachable, even when it has nothing in it', async () => {
    render(<WorkDetail view={view()} taskId={TASK} client={clientWith([])} />);
    for (const tab of WORK_DETAIL_TABS) {
      await userEvent.click(screen.getByRole('tab', { name: tab.label }));
      expect(screen.getByRole('tabpanel')).toBeTruthy();
    }
  });
});

describe('Overview', () => {
  it('says what was asked, where it is, and what is next', () => {
    render(<WorkDetail view={view()} taskId={TASK} />);
    expect(screen.getByText('A社 商談準備')).toBeTruthy();
    expect(screen.getByText('進めています')).toBeTruthy();
    expect(screen.getByText('競合情報を調査中')).toBeTruthy();
  });

  it('does not invent a next step when there is none', () => {
    expect(nextStep(view({ status: 'COMPLETED', steps: [] }))).toBeNull();
    render(<WorkDetail view={view({ status: 'COMPLETED', steps: [] })} taskId={TASK} />);
    expect(screen.getByText('次にすることはありません')).toBeTruthy();
  });

  it('puts the approval summary first when a decision is pending', () => {
    const waiting = view({
      status: 'WAITING_APPROVAL',
      attention: {
        kind: 'approval',
        risk: 'EXTERNAL_COMMIT',
        approvalId: uuidv7(),
        summary: '3人にメールを送信します',
        primaryActionLabel: '3件送信する',
        expiresAt: '2026-08-27T05:00:00.000Z',
      },
    });
    expect(nextStep(waiting)).toBe('3人にメールを送信します');
  });

  it('shows the context it used, and says so when there is no record', async () => {
    const sources: ContextSource[] = [
      {
        id: 'a',
        category: 'internal',
        label: 'Q4提案.pptx',
        reason: null,
        sensitivity: 'PRIVATE',
        removable: true,
        used: true,
      },
    ];
    const { unmount } = render(<WorkDetail view={view()} taskId={TASK} sources={sources} />);
    expect(screen.getByText('Q4提案.pptx')).toBeTruthy();
    unmount();

    render(<WorkDetail view={view()} taskId={TASK} />);
    expect(screen.getByText('記録が残っていません。')).toBeTruthy();
  });
});

describe('Progress', () => {
  it('shows the steps with their timestamps (§9.2)', async () => {
    render(<WorkDetail view={view()} taskId={TASK} />);
    await userEvent.click(screen.getByRole('tab', { name: '経過' }));

    const panel = screen.getByRole('tabpanel');
    expect(panel.textContent).toContain('関連情報を確認');
    expect(panel.textContent).toContain('12 sources');

    const times = [...panel.querySelectorAll('.astra-detail__step .astra-detail__step-time')].map(
      (node) => node.textContent ?? '',
    );
    // 終わった step は開始と終了
    expect(times[0]).toMatch(/^\d{2}:\d{2} 〜 \d{2}:\d{2}$/);
    // 走っている step は開始だけ。終わっていない時刻をでっち上げない。
    expect(times[1]).toMatch(/^\d{2}:\d{2} 〜$/);
  });

  it('does not print a time it does not have', async () => {
    const noTimes = view({
      steps: [
        {
          index: 0,
          state: 'todo',
          label: 'まだです',
          detail: null,
          startedAt: null,
          endedAt: null,
        },
      ],
    });
    render(<WorkDetail view={noTimes} taskId={TASK} />);
    await userEvent.click(screen.getByRole('tab', { name: '経過' }));
    expect(screen.getByRole('tabpanel').textContent).not.toMatch(/\d{2}:\d{2}/);
  });
});

describe('Outputs', () => {
  it('lists what this work produced and links it to the Library', async () => {
    const onOpenArtifact = vi.fn();
    const report = artifact();
    render(
      <WorkDetail
        view={view()}
        taskId={TASK}
        client={clientWith([report])}
        onOpenArtifact={onOpenArtifact}
      />,
    );
    await userEvent.click(screen.getByRole('tab', { name: '成果' }));
    await userEvent.click(await screen.findByRole('button', { name: '競合レポート' }));
    expect(onOpenArtifact).toHaveBeenCalledWith(report.id);
  });

  it('marks a meeting recording as one (§9.2 related meetings)', async () => {
    render(
      <WorkDetail
        view={view()}
        taskId={TASK}
        client={clientWith([artifact({ type: 'MEETING_BUNDLE', title: 'A社定例' })])}
      />,
    );
    await userEvent.click(screen.getByRole('tab', { name: '成果' }));
    expect(await screen.findByText('会議の記録')).toBeTruthy();
  });

  it('says there is nothing yet rather than showing an empty box', async () => {
    render(<WorkDetail view={view()} taskId={TASK} client={clientWith([])} />);
    await userEvent.click(screen.getByRole('tab', { name: '成果' }));
    expect(await screen.findByText('まだ成果物はありません。')).toBeTruthy();
  });
});

describe('Evidence', () => {
  it('says so when the work was not a research run', async () => {
    render(<WorkDetail view={view()} taskId={TASK} client={clientWith([])} />);
    await userEvent.click(screen.getByRole('tab', { name: '根拠' }));
    await waitFor(() =>
      expect(screen.getByText('この仕事は、根拠を集める仕事ではありませんでした。')).toBeTruthy(),
    );
  });

  it('opens the ledger at L0, not at everything (§15)', async () => {
    const evidence = {
      task_id: TASK,
      question: 'A社の売上は',
      source_count: 12,
      confidence: 'high',
      contradiction_count: 0,
      groups: [{ source_type: 'official', count: 12 }],
      key_claims: ['売上は 100 億円'],
      items: [],
    };
    render(<WorkDetail view={view()} taskId={TASK} client={clientWith([artifact()], evidence)} />);
    await userEvent.click(screen.getByRole('tab', { name: '根拠' }));

    expect(await screen.findByText(/出典 12 件/)).toBeTruthy();
    // 掘る前に主張は出さない
    expect(screen.queryByText('売上は 100 億円')).toBeNull();
  });
});

describe('Activity', () => {
  it('summarises in words, without naming a single tool', () => {
    const lines = activityLines(view({ status: 'FAILED', endedAt: '2026-08-27T04:05:00.000Z' }));
    const text = lines.map((l) => l.text).join(' ');
    expect(text).toContain('始めました');
    expect(text).toContain('完了できませんでした');
    // §6.1: tool 名を出さない
    expect(text).not.toMatch(/gmail|crm\.|\.send/);
  });

  it('does not claim an end that has not happened', () => {
    const lines = activityLines(view());
    expect(lines.map((l) => l.text)).not.toContain('終わりました');
  });
});
