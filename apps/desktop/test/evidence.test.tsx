/**
 * Evidence Ledger。UI/UX §15。
 *
 * 見たいのは 2 つ:
 *   - **最初から全部出さない**（出すと結論が読まれなくなる）
 *   - **掘れば必ず出る**（掘れないと、無いのか隠しているのか分からない）
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import {
  contradictionPairs,
  countContradictionPairs,
  ledgerHeadline,
  uuidv7,
  type EvidenceItem,
  type EvidenceLedger,
} from '@astra/contracts';
import { EvidenceLedgerView, TaskEvidence, deeper } from '../src/work/EvidenceLedger.js';

afterEach(cleanup);

const A = uuidv7();
const B = uuidv7();

const item = (over: Partial<EvidenceItem> & Pick<EvidenceItem, 'id' | 'claim'>): EvidenceItem =>
  ({
    source_url: 'https://official.example.com/ir',
    source_type: 'official',
    publisher: 'Example Inc',
    published_at: '2026-08-01T00:00:00.000Z',
    retrieved_at: '2026-08-27T00:00:00.000Z',
    quality_score: 0.9,
    freshness_score: 0.8,
    supports: [],
    contradicts: [],
    ...over,
  }) as EvidenceItem;

const ledger = (over: Partial<EvidenceLedger> = {}): EvidenceLedger =>
  ({
    task_id: uuidv7(),
    question: 'A社の売上は',
    source_count: 12,
    confidence: 'high',
    contradiction_count: 1,
    groups: [
      { source_type: 'official', count: 4 },
      { source_type: 'news', count: 8 },
    ],
    key_claims: ['売上は 100 億円'],
    items: [
      item({ id: A, claim: '売上は 100 億円', contradicts: [B] }),
      item({
        id: B,
        claim: '売上は 120 億円',
        source_type: 'news',
        source_url: 'https://news.example.com/story',
        publisher: 'News Daily',
        contradicts: [A],
      }),
    ],
    ...over,
  }) as EvidenceLedger;

describe('L0 — what is visible without digging', () => {
  it('shows the count, the confidence and the contradictions, and nothing else', () => {
    render(<EvidenceLedgerView ledger={ledger()} />);
    expect(screen.getByText('出典 12 件 · 確かさ 高 · 食い違い 1 件')).toBeTruthy();
    // 主張も出典も、掘る前には出さない
    expect(screen.queryByText('売上は 100 億円')).toBeNull();
    expect(screen.queryByText('原文を見る')).toBeNull();
  });

  it('says "0 contradictions" rather than staying silent', () => {
    // 黙ると、見ていないのか無いのか分からない
    expect(ledgerHeadline(ledger({ contradiction_count: 0 }))).toContain('食い違い 0 件');
  });
});

describe('digging one level at a time', () => {
  it('never skips a level', () => {
    expect(deeper('L0')).toBe('L1');
    expect(deeper('L1')).toBe('L2');
    expect(deeper('L2')).toBe('L3');
    expect(deeper('L3')).toBe('L3');
  });

  it('L1 shows the source breakdown and the heaviest claims', async () => {
    render(<EvidenceLedgerView ledger={ledger()} />);
    await userEvent.click(screen.getByRole('button', { name: '根拠を見る' }));

    expect(screen.getByText('一次情報 4')).toBeTruthy();
    expect(screen.getByText('報道 8')).toBeTruthy();
    expect(screen.getByText('売上は 100 億円')).toBeTruthy();
    // L3 はまだ出さない
    expect(screen.queryByText('原文を見る')).toBeNull();
  });

  it('L2 shows both sides of a disagreement, not the winner', async () => {
    render(<EvidenceLedgerView ledger={ledger()} />);
    await userEvent.click(screen.getByRole('button', { name: '根拠を見る' }));
    await userEvent.click(screen.getByRole('button', { name: '主張と出典の関係を見る' }));

    // 片方だけを採って消さない（正本 §8.1）
    const panel = screen.getByLabelText('根拠');
    expect(panel.textContent).toContain('売上は 100 億円');
    expect(panel.textContent).toContain('売上は 120 億円');
    expect(panel.textContent).toContain('1 件と食い違います');
  });

  it('L3 shows where it came from, and when', async () => {
    render(<EvidenceLedgerView ledger={ledger()} />);
    await userEvent.click(screen.getByRole('button', { name: '根拠を見る' }));
    await userEvent.click(screen.getByRole('button', { name: '主張と出典の関係を見る' }));
    await userEvent.click(screen.getByRole('button', { name: '出典そのものを見る' }));

    expect(screen.getAllByRole('link', { name: '原文を見る' })).toHaveLength(2);
    expect(screen.getByText('News Daily')).toBeTruthy();
    // 発行日と取得日の両方。片方だけでは古さを判断できない。
    expect(screen.getByLabelText('根拠').textContent).toMatch(/発行・.*取得/);
  });

  it('folds back to the headline', async () => {
    render(<EvidenceLedgerView ledger={ledger()} />);
    await userEvent.click(screen.getByRole('button', { name: '根拠を見る' }));
    await userEvent.click(screen.getByRole('button', { name: 'たたむ' }));
    expect(screen.queryByText('売上は 100 億円')).toBeNull();
  });
});

describe('counting disagreements', () => {
  it('counts pairs, not rows', () => {
    // A と B が食い違うとき、行は 2 つ・食い違いは 1 件
    expect(countContradictionPairs(ledger().items)).toBe(1);
    expect(contradictionPairs(ledger())).toHaveLength(1);
  });

  it('does not count a partner that is not in the ledger', () => {
    const orphan = ledger({ items: [item({ id: A, claim: 'x', contradicts: [uuidv7()] })] });
    expect(countContradictionPairs(orphan.items)).toBe(0);
    expect(contradictionPairs(orphan)).toHaveLength(0);
  });

  it('counts three-way disagreements as three', () => {
    const C = uuidv7();
    const rows = [
      { id: A, contradicts: [B, C] },
      { id: B, contradicts: [A, C] },
      { id: C, contradicts: [A, B] },
    ];
    // 行は 3、組も 3。半分にすると 2 になって合わない。
    expect(countContradictionPairs(rows)).toBe(3);
  });
});

describe('when there is no ledger', () => {
  it('separates "not that kind of work" from "could not read it"', async () => {
    const missing = {
      taskEvidence: vi.fn(async () => {
        throw new Error('common.not_found');
      }),
    } as never;
    const { unmount } = render(<TaskEvidence client={missing} taskId={uuidv7()} />);
    await waitFor(() =>
      expect(screen.getByText('この仕事は、根拠を集める仕事ではありませんでした。')).toBeTruthy(),
    );
    unmount();

    const broken = {
      taskEvidence: vi.fn(async () => {
        throw new Error('接続できません');
      }),
    } as never;
    render(<TaskEvidence client={broken} taskId={uuidv7()} />);
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('接続できません'));
  });

  it('says a research run with nothing in it found nothing', async () => {
    const empty = {
      taskEvidence: vi.fn(async () =>
        ledger({
          source_count: 0,
          confidence: 'low',
          contradiction_count: 0,
          key_claims: [],
          items: [],
          groups: [],
        }),
      ),
    } as never;
    render(<TaskEvidence client={empty} taskId={uuidv7()} />);
    await waitFor(() => expect(screen.getByText(/出典 0 件/)).toBeTruthy());
    await userEvent.click(screen.getByRole('button', { name: '根拠を見る' }));
    expect(screen.getByText('主張として取り出せたものがありません。')).toBeTruthy();
  });
});
