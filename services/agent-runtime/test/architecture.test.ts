/**
 * Architecture Coordinator。正本 §15.6。
 *
 * **設計判断はしない。**版と質疑を落とさないだけ。
 */
import { describe, expect, it } from 'vitest';
import type { DomainEntity } from '@astra/contracts';
import {
  issueGaps,
  latestRevisions,
  openRfis,
  rfiProblems,
  type Revision,
  type Rfi,
} from '../src/architecture.js';

const NOW = new Date('2026-08-27T00:00:00.000Z');

const rev = (over: Partial<Revision> & Pick<Revision, 'id' | 'label'>): Revision => ({
  drawingId: 'd1',
  issuedAt: '2026-08-01T00:00:00.000Z',
  artifactId: null,
  ...over,
});

const rfi = (over: Partial<Rfi> & Pick<Rfi, 'id' | 'question'>): Rfi => ({
  status: 'SENT',
  dueAt: null,
  drawingId: null,
  ...over,
});

const issue = (fields: Record<string, unknown>): DomainEntity =>
  ({
    id: String(fields['id'] ?? 'i1'),
    plugin_id: 'com.astra.architecture',
    entity_type: 'arch_issue',
    title: String(fields['title'] ?? ''),
    fields: { status: 'OPEN', ...fields },
    source_task_id: null,
    source_meeting_id: null,
    created_at: NOW.toISOString(),
    updated_at: NOW.toISOString(),
  }) as DomainEntity;

describe('which drawing revision is current', () => {
  it('decides by the issue date, not the label', () => {
    const latest = latestRevisions([
      rev({ id: 'r1', label: 'A-9', issuedAt: '2026-08-20T00:00:00.000Z' }),
      rev({ id: 'r2', label: 'A-10', issuedAt: '2026-08-10T00:00:00.000Z' }),
    ]);
    // 文字列で並べると A-10 が先に来てしまう
    expect(latest[0]!.revisions.map((r) => r.label)).toEqual(['A-9']);
  });

  it('refuses to pick when two were issued the same day', () => {
    const latest = latestRevisions([
      rev({ id: 'r1', label: 'A', issuedAt: '2026-08-20T00:00:00.000Z' }),
      rev({ id: 'r2', label: 'B', issuedAt: '2026-08-20T00:00:00.000Z' }),
    ]);
    // どちらを使うべきかは人が決める
    expect(latest[0]!.ambiguous).toBe(true);
    expect(latest[0]!.revisions).toHaveLength(2);
  });

  it('reports the ones with no date instead of ordering them anyway', () => {
    const latest = latestRevisions([
      rev({ id: 'r1', label: 'A', issuedAt: '2026-08-20T00:00:00.000Z' }),
      rev({ id: 'r2', label: 'B', issuedAt: null }),
    ]);
    expect(latest[0]!.revisions.map((r) => r.label)).toEqual(['A']);
    expect(latest[0]!.undated.map((r) => r.label)).toEqual(['B']);
  });

  it('says nothing is current when nothing is dated', () => {
    const latest = latestRevisions([rev({ id: 'r1', label: 'A', issuedAt: null })]);
    expect(latest[0]!.revisions).toEqual([]);
    expect(latest[0]!.undated).toHaveLength(1);
  });
});

describe('open questions', () => {
  it('puts the overdue ones first', () => {
    const open = openRfis(
      [
        rfi({ id: 'a', question: '来月', dueAt: '2026-09-10T00:00:00.000Z' }),
        rfi({ id: 'b', question: '過ぎている', dueAt: '2026-08-01T00:00:00.000Z' }),
      ],
      NOW,
    );
    expect(open.map((r) => r.question)).toEqual(['過ぎている', '来月']);
  });

  it('does not treat a missing deadline as "not yet"', () => {
    const open = openRfis(
      [
        rfi({ id: 'a', question: '期限なし' }),
        rfi({ id: 'b', question: '先の話', dueAt: '2026-09-10T00:00:00.000Z' }),
      ],
      NOW,
    );
    expect(open[0]!.question).toBe('期限なし');
    expect(open[0]!.daysLeft).toBeNull();
  });

  it('leaves answered questions out', () => {
    expect(openRfis([rfi({ id: 'a', question: '済み', status: 'ANSWERED' })], NOW)).toEqual([]);
  });
});

describe('issues', () => {
  it('says which ones have no owner or no deadline', () => {
    const gaps = issueGaps([
      issue({ id: 'i1', title: '担当なし', due_at: '2026-09-01' }),
      issue({ id: 'i2', title: '揃っている', owner: '山田', due_at: '2026-09-01' }),
    ]);
    expect(gaps).toHaveLength(1);
    expect(gaps[0]!.missing).toEqual(['担当']);
  });

  it('leaves closed issues alone', () => {
    expect(issueGaps([issue({ id: 'i1', title: '済み', status: 'CLOSED' })])).toEqual([]);
  });
});

describe('drafting a question', () => {
  it('refuses to bundle two questions into one', () => {
    // まとめると、答える側がどれに答えたのか分からなくなる
    const problems = rfiProblems('梁せいは？ それと納まりは？');
    expect(problems[0]).toContain('分けてください');
  });

  it('accepts a single question', () => {
    expect(rfiProblems('梁せいの指示をお願いできますか？')).toEqual([]);
  });

  it('refuses an empty one', () => {
    expect(rfiProblems('   ')).toContain('質疑の本文がありません');
  });
});
