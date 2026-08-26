/**
 * Care Support Agent。正本 §15.4。
 *
 * §15.4 は REGULATED policy を要求している。
 * ここで確かめたいのは **書かないことを書いていないか**。
 */
import { describe, expect, it } from 'vitest';
import type { DomainEntity } from '@astra/contracts';
import {
  handoffSummary,
  incidentDraft,
  reviewsDue,
  toShiftNote,
  type ShiftNote,
} from '../src/care.js';

const NOW = new Date('2026-08-27T09:00:00.000Z');

const note = (over: Partial<ShiftNote> & Pick<ShiftNote, 'id' | 'residentName'>): ShiftNote => ({
  residentId: 'r1',
  shift: '日勤',
  recordedAt: '2026-08-27T08:00:00.000Z',
  summary: '朝食は全量',
  observation: null,
  changed: false,
  ...over,
});

const entity = (fields: Record<string, unknown>): DomainEntity =>
  ({
    id: 'e1',
    plugin_id: 'com.astra.care',
    entity_type: 'incident',
    title: String(fields['title'] ?? ''),
    fields,
    source_task_id: null,
    source_meeting_id: null,
    created_at: NOW.toISOString(),
    updated_at: NOW.toISOString(),
  }) as DomainEntity;

describe('the handoff', () => {
  it('says there is nothing rather than filling the gap', () => {
    expect(handoffSummary([])).toBe('この勤務帯の記録はありません。');
  });

  it('puts what changed first', () => {
    const summary = handoffSummary([
      note({ id: 'a', residentName: '変化なしの方' }),
      note({ id: 'b', residentName: '変化ありの方', changed: true }),
    ]);
    // 名前順に並べると、見落としが後ろに沈む
    expect(summary.indexOf('変化ありの方')).toBeLessThan(summary.indexOf('変化なしの方'));
    expect(summary).toContain('【変化あり】');
  });

  it('does not call an unrecorded change "no change"', () => {
    const summary = handoffSummary([note({ id: 'a', residentName: '記録なし', changed: null })]);
    // 記録が無いことは、変化が無いことではない
    expect(summary).toContain('【記録なしの項目あり】');
  });

  it('carries only what was written down', () => {
    const summary = handoffSummary([
      note({ id: 'a', residentName: '田中', summary: '昼食は半量', observation: '体温 36.8' }),
    ]);
    expect(summary).toContain('昼食は半量');
    expect(summary).toContain('体温 36.8');
    // 良し悪しの判断を足さない
    expect(summary).not.toMatch(/落ち着|良好|問題な/);
  });

  it('reads an absent "changed" as unknown, not as false', () => {
    const parsed = toShiftNote(entity({ summary: 'x', shift: '夜勤' }), '田中');
    expect(parsed.changed).toBeNull();
  });
});

describe('the incident draft', () => {
  it('leaves what it does not know empty, and says so', () => {
    const draft = incidentDraft(entity({ title: '転倒', where: '居室' }), '田中');
    expect(draft.missing).toContain('いつ');
    expect(draft.missing).toContain('誰が見つけたか');
    // それらしい値で埋めると、記録として使えなくなる
    expect(draft.markdown).toContain('| いつ |  |');
    expect(draft.markdown).toContain('提出する前に埋めてください');
  });

  it('still asks a person to check when everything is filled in', () => {
    const draft = incidentDraft(
      entity({
        title: '転倒',
        occurred_at: '2026-08-27',
        where: '居室',
        who_found: '山田',
        what_happened: '床に座り込んでいた',
        response: 'バイタル測定',
      }),
      '田中',
    );
    expect(draft.missing).toEqual([]);
    // 揃っていても、提出するのは人
    expect(draft.markdown).toContain('確かめてから提出してください');
  });
});

describe('care plan reviews', () => {
  const plan = (title: string, reviewDue: string | null) => ({
    title,
    residentName: '田中',
    reviewDue,
  });

  it('puts the overdue ones first', () => {
    const due = reviewsDue(
      [plan('来月', '2026-09-20T00:00:00.000Z'), plan('過ぎている', '2026-08-01T00:00:00.000Z')],
      NOW,
    );
    expect(due.map((d) => d.title)).toEqual(['過ぎている', '来月']);
  });

  it('does not treat a missing date as "not yet"', () => {
    const due = reviewsDue(
      [plan('期日なし', null), plan('先の話', '2026-09-20T00:00:00.000Z')],
      NOW,
    );
    // 期日が入っていないこと自体が、知らせるべきこと
    expect(due[0]!.title).toBe('期日なし');
    expect(due[0]!.daysLeft).toBeNull();
  });

  it('leaves the far future alone', () => {
    expect(reviewsDue([plan('ずっと先', '2027-01-01T00:00:00.000Z')], NOW)).toEqual([]);
  });
});
