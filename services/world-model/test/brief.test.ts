/**
 * 「今日気にすべきこと」。正本 §2.1、UI/UX §8.1、Phase 6 §4。
 *
 * **話しかけ過ぎないための仕組み**であることを確かめる。
 */
import { describe, expect, it } from 'vitest';
import { MAX_ATTENTION_ITEMS, uuidv7, type WorldFact } from '@astra/contracts';
import { buildBrief, type MeetingLike, type TaskLike } from '../src/brief.js';

const NOW = new Date('2026-08-26T09:00:00.000Z');

const commitment = (over: Partial<WorldFact> = {}): WorldFact =>
  ({
    id: uuidv7(),
    tenant_id: uuidv7(),
    kind: 'commitment',
    statement: '見積を送る',
    subject_entity_id: null,
    source: { kind: 'user', stated_at: NOW.toISOString() },
    status: 'OPEN',
    due_at: null,
    confidence: 1,
    created_at: NOW.toISOString(),
    updated_at: NOW.toISOString(),
    ...over,
  }) as WorldFact;

const task = (over: Partial<TaskLike> = {}): TaskLike => ({
  id: uuidv7(),
  title: '競合調査',
  status: 'RUNNING',
  updatedAt: NOW.toISOString(),
  ...over,
});

const meeting = (over: Partial<MeetingLike> = {}): MeetingLike => ({
  id: uuidv7(),
  title: 'A社 商談',
  startsAt: new Date(NOW.getTime() + 20 * 60_000).toISOString(),
  ...over,
});

const brief = (over: Partial<Parameters<typeof buildBrief>[0]> = {}) =>
  buildBrief({ commitments: [], tasks: [], meetings: [], now: NOW, ...over });

describe('buildBrief', () => {
  it('never puts more than three things in front of the user', () => {
    const many = Array.from({ length: 10 }, () =>
      task({ status: 'WAITING_APPROVAL', title: '承認待ち' }),
    );
    const result = brief({ tasks: many });
    expect(result.attention).toHaveLength(MAX_ATTENTION_ITEMS);
    // 4 件目以降は消えるのではなく「すべて見る」へ
    expect(result.more).toHaveLength(7);
  });

  it('leaves out what is not worth interrupting for', () => {
    // 済んだ知らせは、黙っている価値がある
    const old = task({
      status: 'COMPLETED',
      updatedAt: new Date(NOW.getTime() - 48 * 3_600_000).toISOString(),
    });
    expect(brief({ tasks: [old] }).attention).toEqual([]);
  });

  it('does not resurface a commitment that is already settled', () => {
    const result = brief({
      commitments: [
        commitment({ status: 'DONE', statement: '済んだこと' }),
        commitment({ status: 'DROPPED', statement: 'やめたこと' }),
      ],
    });
    expect([...result.attention, ...result.more]).toEqual([]);
  });

  it('puts an overdue commitment above one that is merely due', () => {
    const overdue = commitment({
      statement: '過ぎている',
      due_at: new Date(NOW.getTime() - 3 * 86_400_000).toISOString(),
    });
    const soon = commitment({
      statement: '来週まで',
      due_at: new Date(NOW.getTime() + 6 * 86_400_000).toISOString(),
    });
    const result = brief({ commitments: [soon, overdue] });
    expect(result.attention[0]!.title).toBe('過ぎている');
    expect(result.attention[0]!.detail).toContain('3 日過ぎています');
  });

  it('puts a commitment with no deadline below one that has a deadline', () => {
    const dated = commitment({
      statement: '今日まで',
      due_at: NOW.toISOString(),
    });
    const undated = commitment({ statement: 'いつか' });
    const result = brief({ commitments: [undated, dated] });
    expect(result.attention.map((i) => i.title)).toEqual(['今日まで', 'いつか']);
    expect(result.attention[1]!.detail).toBe('期限は決まっていません');
  });

  it('raises what is blocked on the user above what is merely finished', () => {
    const waiting = task({ status: 'WAITING_APPROVAL', title: '確認待ち' });
    const done = task({ status: 'COMPLETED', title: '終わった' });
    const result = brief({ tasks: [waiting, done] });
    expect(result.attention[0]!.title).toBe('確認待ち');
    expect(result.attention[0]!.severity).toBe('action-required');
  });

  it('mentions a meeting only when it is close', () => {
    expect(brief({ meetings: [meeting()] }).attention).toHaveLength(1);
    // 明日の会議は今日の朝に割り込む理由がない
    const tomorrow = meeting({ startsAt: new Date(NOW.getTime() + 26 * 3_600_000).toISOString() });
    expect(brief({ meetings: [tomorrow] }).attention).toEqual([]);
    // 終わった会議も出さない
    const past = meeting({ startsAt: new Date(NOW.getTime() - 60_000).toISOString() });
    expect(brief({ meetings: [past] }).attention).toEqual([]);
  });

  it('gives every item something to press and somewhere to go', () => {
    const result = brief({
      commitments: [commitment()],
      tasks: [task({ status: 'FAILED' })],
      meetings: [meeting()],
    });
    for (const item of [...result.attention, ...result.more]) {
      expect(item.action_label.length).toBeGreaterThan(0);
      expect(item.target).toBeDefined();
    }
  });

  it('is stable when two items score the same', () => {
    const a = task({ status: 'WAITING_APPROVAL', title: 'A' });
    const b = task({ status: 'WAITING_APPROVAL', title: 'B' });
    const first = buildBrief({ commitments: [], tasks: [a, b], meetings: [], now: NOW });
    const second = buildBrief({ commitments: [], tasks: [b, a], meetings: [], now: NOW });
    expect(first.attention.map((i) => i.id)).toEqual(second.attention.map((i) => i.id));
  });

  it('says nothing at all when there is nothing worth saying', () => {
    const result = brief();
    expect(result.attention).toEqual([]);
    expect(result.more).toEqual([]);
    expect(result.generated_at).toBe(NOW.toISOString());
  });
});
