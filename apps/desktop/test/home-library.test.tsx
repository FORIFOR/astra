/**
 * Home と Library。UI-3。UI/UX §8・§10・§16、正本 §2.1。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { TaskId, uuidv7, type Artifact } from '@astra/contracts';
import type { TaskView } from '@astra/api-client';
import {
  ATTENTION_LIMIT,
  LONG_TASK_MS,
  buildAttentionFeed,
  greeting,
  proactiveScore,
} from '../src/home/attention.js';
import { HomePage } from '../src/pages/Home.js';
import { LibraryPage, LIBRARY_TYPE_CHIPS, matchesChip } from '../src/pages/Library.js';

afterEach(cleanup);

const NOW = new Date('2026-08-26T09:00:00.000Z').getTime();
const ago = (ms: number) => new Date(NOW - ms).toISOString();

const task = (over: Partial<TaskView> = {}): TaskView =>
  ({
    id: uuidv7(),
    tenant_id: uuidv7(),
    created_by: uuidv7(),
    conversation_id: null,
    kind: 'echo',
    title: '仕事',
    status: 'RUNNING',
    input: {},
    result_artifact_id: null,
    error: null,
    created_at: ago(60_000),
    started_at: ago(60_000),
    completed_at: null,
    updated_at: ago(1_000),
    dockState: 'WORKING',
    ...over,
  }) as TaskView;

const artifact = (over: Partial<Artifact> = {}): Artifact =>
  ({
    id: uuidv7(),
    tenant_id: uuidv7(),
    owner_id: uuidv7(),
    type: 'DOCUMENT',
    title: '提案書',
    mime_type: 'text/markdown',
    source_agent_id: null,
    source_task_id: null,
    source_meeting_id: null,
    parent_artifact_id: null,
    version: 1,
    object_key: 'k',
    size: 10,
    sha256: 'a'.repeat(64),
    tags: [],
    entities: [],
    lineage: [],
    sensitivity: 'PRIVATE',
    searchable_text_ref: null,
    created_at: ago(3_600_000),
    updated_at: ago(3_600_000),
    ...over,
  }) as Artifact;

describe('proactive score (正本 §2.1)', () => {
  it('subtracts the cost of interrupting', () => {
    const base = { importance: 1, urgency: 1, confidence: 1, relevance: 1 };
    expect(proactiveScore({ ...base, interruptionCost: 0 })).toBe(1);
    expect(proactiveScore({ ...base, interruptionCost: 0.5 })).toBe(0.5);
  });

  it('drops to nothing when any signal is absent', () => {
    expect(
      proactiveScore({
        importance: 1,
        urgency: 0,
        confidence: 1,
        relevance: 1,
        interruptionCost: 0,
      }),
    ).toBe(0);
  });
});

describe('attention feed (§8.1)', () => {
  it('shows at most three and counts the rest', () => {
    const feed = buildAttentionFeed(
      Array.from({ length: 6 }, () => task({ status: 'WAITING_APPROVAL' })),
      NOW,
    );
    expect(feed.items).toHaveLength(ATTENTION_LIMIT);
    expect(feed.overflow).toBe(3);
  });

  it('puts what needs a person ahead of what is merely done', () => {
    const feed = buildAttentionFeed(
      [
        task({
          status: 'COMPLETED',
          title: '完了',
          started_at: ago(120_000),
          completed_at: ago(1_000),
        }),
        task({ status: 'FAILED', title: '失敗' }),
        task({ status: 'WAITING_APPROVAL', title: '承認待ち' }),
      ],
      NOW,
    );
    expect(feed.items.map((i) => i.title)).toEqual(['承認待ち', '失敗', '完了']);
  });

  it('stays quiet about work that is still running', () => {
    // 進行中を Attention に混ぜると、常に何かが出続けて意味がなくなる
    expect(buildAttentionFeed([task({ status: 'RUNNING' })], NOW).items).toEqual([]);
  });

  it('stays quiet about a task that finished in a moment', () => {
    // §8.1 が挙げるのは「完了した長時間 Task」
    const quick = task({
      status: 'COMPLETED',
      started_at: ago(2_000),
      completed_at: ago(1_000),
    });
    expect(buildAttentionFeed([quick], NOW).items).toEqual([]);

    const slow = task({
      status: 'COMPLETED',
      started_at: ago(LONG_TASK_MS + 60_000),
      completed_at: ago(1_000),
    });
    expect(buildAttentionFeed([slow], NOW).items).toHaveLength(1);
  });

  it('forgets what happened more than a day ago', () => {
    const stale = task({ status: 'WAITING_APPROVAL', updated_at: ago(48 * 60 * 60 * 1000) });
    expect(buildAttentionFeed([stale], NOW).items).toEqual([]);
  });

  it('labels severity so it is not carried by colour alone (§19)', () => {
    const feed = buildAttentionFeed([task({ status: 'WAITING_APPROVAL' })], NOW);
    expect(feed.items[0]?.severity).toBe('action-required');
    expect(feed.items[0]?.actionLabel).toBe('確認する');
  });
});

describe('greeting', () => {
  it('follows the time of day', () => {
    expect(greeting(8)).toBe('おはようございます');
    expect(greeting(14)).toBe('こんにちは');
    expect(greeting(21)).toBe('こんばんは');
    expect(greeting(3)).toBe('こんばんは');
  });
});

describe('Home (§8)', () => {
  it('asks for one job instead of explaining features when empty', () => {
    render(<HomePage now={NOW} />);
    expect(screen.getByText('今、面倒なことを1つ頼んでください。')).toBeTruthy();
  });

  it('keeps business KPIs off the home screen', () => {
    render(
      <HomePage
        now={NOW}
        tasks={[task({ status: 'WAITING_APPROVAL', title: '商談準備' })]}
        artifacts={[artifact()]}
      />,
    );
    // §8.1: 営業 KPI や業務 KPI は Home に常設しない
    expect(document.body.textContent).not.toMatch(/KPI|売上|パイプライン/);
  });

  it('opens the task behind an attention card', async () => {
    const onOpenTask = vi.fn();
    const user = userEvent.setup();
    const waiting = task({ status: 'WAITING_APPROVAL', title: '商談準備' });
    render(<HomePage now={NOW} tasks={[waiting]} onOpenTask={onOpenTask} />);

    await user.click(screen.getByText('商談準備'));
    expect(onOpenTask).toHaveBeenCalledWith(waiting.id);
  });

  it('offers a way to the rest without showing it all', async () => {
    const onShowAll = vi.fn();
    const user = userEvent.setup();
    render(
      <HomePage
        now={NOW}
        tasks={Array.from({ length: 5 }, () => task({ status: 'WAITING_APPROVAL' }))}
        onShowAll={onShowAll}
      />,
    );
    await user.click(screen.getByText('すべて見る（他 2 件）'));
    expect(onShowAll).toHaveBeenCalled();
  });

  it('leads from a recent artifact into the library', async () => {
    const onOpenArtifact = vi.fn();
    const user = userEvent.setup();
    const doc = artifact({ title: 'A社 提案書' });
    render(<HomePage now={NOW} artifacts={[doc]} onOpenArtifact={onOpenArtifact} />);

    await user.click(screen.getByText('A社 提案書'));
    expect(onOpenArtifact).toHaveBeenCalledWith(doc.id);
  });
});

describe('Library (§10)', () => {
  it('offers the type chips the spec lists', () => {
    expect(LIBRARY_TYPE_CHIPS.map((c) => c.id)).toEqual([
      'ALL',
      'MEETING_BUNDLE',
      'REPORT',
      'DOCUMENT',
      'IMAGE',
      'VIDEO',
      'OTHER',
    ]);
  });

  it('sends anything unnamed to Other so nothing is lost', () => {
    expect(matchesChip('TRANSCRIPT', 'OTHER')).toBe(true);
    expect(matchesChip('CODE', 'OTHER')).toBe(true);
    expect(matchesChip('DOCUMENT', 'OTHER')).toBe(false);
    expect(matchesChip('DOCUMENT', 'ALL')).toBe(true);
  });

  it('filters by type and by natural-language search', async () => {
    const user = userEvent.setup();
    render(
      <LibraryPage
        artifacts={[
          artifact({ title: 'A社 提案書', type: 'DOCUMENT' }),
          artifact({ title: '半導体市場レポート', type: 'REPORT' }),
        ]}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'レポート' }));
    expect(screen.queryByText('A社 提案書')).toBeNull();

    await user.click(screen.getByRole('button', { name: 'すべて' }));
    await user.type(screen.getByRole('searchbox'), '提案');
    expect(screen.queryByText('半導体市場レポート')).toBeNull();
    expect(screen.getByText('A社 提案書')).toBeTruthy();
  });

  it('tells the user where results will appear when there is nothing yet', () => {
    render(<LibraryPage artifacts={[]} />);
    expect(screen.getByText(/仕事を1つ頼むとここに残ります/)).toBeTruthy();
  });

  it('traces an artifact back to the work that made it (§10.2)', async () => {
    const onOpenTask = vi.fn();
    const user = userEvent.setup();
    const sourceTask = TaskId.parse(uuidv7());
    const doc = artifact({ title: 'Echo result', source_task_id: sourceTask });
    render(<LibraryPage artifacts={[doc]} selectedId={doc.id} onOpenTask={onOpenTask} />);

    const preview = screen.getByLabelText('プレビュー');
    await user.click(within(preview).getByRole('button', { name: 'この仕事' }));
    expect(onOpenTask).toHaveBeenCalledWith(sourceTask);
  });

  it('says plainly when an artifact has no source task', () => {
    const doc = artifact({ source_task_id: null });
    render(<LibraryPage artifacts={[doc]} selectedId={doc.id} />);
    // §10.2 Produced by: 手で入れたものは「手で追加」
    expect(screen.getAllByText('手で追加').length).toBeGreaterThan(0);
  });

  it('reports the real sharing state, not a hard-coded "off" (§10.2)', async () => {
    const doc = artifact();
    const client = { artifactShares: async () => [] } as never;
    render(<LibraryPage client={client} artifacts={[doc]} selectedId={doc.id} />);
    // サーバが「無い」と言ってから、はじめてオフと書く
    await waitFor(() => expect(screen.getByText('共有: オフ')).toBeTruthy());
  });

  it('does not claim "off" while it has not asked yet', () => {
    const doc = artifact();
    render(<LibraryPage artifacts={[doc]} selectedId={doc.id} />);
    expect(screen.getByText('共有: 確認しています')).toBeTruthy();
    expect(screen.queryByText('共有: オフ')).toBeNull();
  });

  it('offers both "later" and a lasting refusal (§16)', async () => {
    const onDismiss = vi.fn();
    const waiting = task({ status: 'WAITING_APPROVAL', title: '承認待ち' });
    render(<HomePage tasks={[waiting]} onDismiss={onDismiss} />);

    await userEvent.click(screen.getByRole('button', { name: '今後は出さない' }));
    expect(onDismiss).toHaveBeenCalledWith(expect.stringContaining(waiting.id), 'never');
    // 押した直後に消える。返事を待って残っていると、押していないように見える。
    expect(screen.queryByText('承認待ち')).toBeNull();
  });

  it('does not offer a refusal it cannot remember', () => {
    // onDismiss が無いなら、押せる口を出さない
    render(<HomePage tasks={[task({ status: 'WAITING_APPROVAL', title: '承認待ち' })]} />);
    expect(screen.queryByRole('button', { name: '今後は出さない' })).toBeNull();
  });

  it('labels sensitive artifacts in text, not colour alone', () => {
    const doc = artifact({ sensitivity: 'CONFIDENTIAL' });
    render(<LibraryPage artifacts={[doc]} />);
    // 絞り込みの選択肢にも同じ言葉が出る（§10.1 Sensitivity）ので、複数を許す
    expect(screen.getAllByText('社外秘').length).toBeGreaterThan(0);
  });
});

describe('Home with the server brief (Phase 6)', () => {
  const briefItem = (over: Record<string, unknown> = {}) => ({
    id: 'commitment:1',
    severity: 'action-required',
    title: '見積を送る',
    detail: '2 日過ぎています',
    action_label: '確認する',
    target: { kind: 'commitment', fact_id: uuidv7() },
    score: 0.8,
    ...over,
  });

  it('shows what the server decided, not a client rebuild', () => {
    // client は commitment も会議も持っていない。組み直すと task だけの feed に戻る。
    render(
      <HomePage
        tasks={[]}
        brief={
          {
            attention: [briefItem()],
            more: [],
            generated_at: new Date().toISOString(),
          } as never
        }
      />,
    );
    expect(screen.getByText('見積を送る')).toBeTruthy();
    expect(screen.getByText('2 日過ぎています')).toBeTruthy();
  });

  it('says how many more there are without listing them', () => {
    render(
      <HomePage
        tasks={[]}
        brief={
          {
            attention: [briefItem()],
            more: [briefItem({ id: 'commitment:2', title: '見えないはず' })],
            generated_at: new Date().toISOString(),
          } as never
        }
      />,
    );
    // 4 件目以降は「すべて見る」へ（UI/UX §8.1）
    expect(screen.queryByText('見えないはず')).toBeNull();
    expect(screen.getByText(/すべて見る/)).toBeTruthy();
  });

  it('falls back to the tasks it has when the brief could not be fetched', () => {
    render(<HomePage tasks={[]} brief={null} />);
    expect(screen.getByText('今、面倒なことを1つ頼んでください。')).toBeTruthy();
  });
});

describe('Home is an entry, not just a list (§8)', () => {
  it('offers the universal entry on the first line', () => {
    render(<HomePage now={NOW} />);
    // §8 の 1 行目「何を終わらせますか？」
    expect(screen.getByRole('textbox', { name: '何を終わらせますか' })).toBeTruthy();
  });

  it('hands what was typed to the caller, and clears the field', async () => {
    const user = userEvent.setup();
    const onAsk = vi.fn();
    render(<HomePage now={NOW} onAsk={onAsk} />);
    const field = screen.getByRole('textbox', { name: '何を終わらせますか' });
    await user.type(field, 'A社の提案を直して{Enter}');
    expect(onAsk).toHaveBeenCalledWith('A社の提案を直して');
    expect((field as HTMLInputElement).value).toBe('');
  });

  it('does not send an empty request', async () => {
    const user = userEvent.setup();
    const onAsk = vi.fn();
    render(<HomePage now={NOW} onAsk={onAsk} />);
    await user.type(screen.getByRole('textbox', { name: '何を終わらせますか' }), '   {Enter}');
    expect(onAsk).not.toHaveBeenCalled();
  });

  it('shows the state of each active job in words', () => {
    render(<HomePage now={NOW} tasks={[task({ status: 'RUNNING', title: '競合20社調査' })]} />);
    // 見出しの「進行中」とは別に、行そのものに状態が書いてある
    const row = screen.getByRole('button', { name: /競合20社調査/ });
    expect(row.textContent).toContain('進行中');
  });
});
