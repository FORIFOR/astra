/**
 * EHR Assist。正本 §15.5。
 *
 * 確かめたいのは 1 行:
 * **診断も治療方針も、自分で決めていないこと。**
 */
import { describe, expect, it } from 'vitest';
import type { DomainEntity } from '@astra/contracts';
import {
  checkDraft,
  citedLines,
  encounterSummary,
  extract,
  extractionTable,
  toClinicalNote,
  type ClinicalNote,
} from '../src/ehr.js';

const note = (over: Partial<ClinicalNote> & Pick<ClinicalNote, 'id' | 'body'>): ClinicalNote => ({
  title: '記録',
  author: '担当医',
  encounterId: 'e1',
  signed: true,
  ...over,
});

describe('citations', () => {
  it('keeps the line it came from, not a paraphrase', () => {
    const lines = citedLines([note({ id: 'n1', body: '体温 37.2\n\n血圧 128/78' })]);
    // 言い換えた時点で「どの記録の何行目か」が言えなくなる
    expect(lines).toEqual([
      { text: '体温 37.2', noteId: 'n1', line: 1 },
      { text: '血圧 128/78', noteId: 'n1', line: 3 },
    ]);
  });

  it('puts a source on every line of the summary', () => {
    const summary = encounterSummary([note({ id: 'n1', body: '歩行時にふらつきあり' })]);
    expect(summary).toContain('歩行時にふらつきあり');
    expect(summary).toContain('出典: n1 行 1');
    // 要約と言いながら、診断を足さない
    expect(summary).toContain('診断・治療方針は含みません');
  });

  it('says there is no record rather than no findings', () => {
    // 記録が無いことと、所見が無いことは違う
    expect(encounterSummary([])).toBe('この受診に紐づく記録がありません。');
  });
});

describe('structured extraction', () => {
  it('takes the value as written', () => {
    const rows = extract([note({ id: 'n1', body: '血圧 128/78 体温 37.2 SpO2 97%' })]);
    const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
    expect(byId['bp']!.value).toBe('128/78');
    // 丸めない。単位を変えない。
    expect(byId['temperature']!.value).toBe('37.2');
    expect(byId['spo2']!.value).toBe('97');
  });

  it('leaves what is not written as unknown', () => {
    const rows = extract([note({ id: 'n1', body: '体温 36.5' })]);
    expect(rows.find((r) => r.id === 'bp')!.value).toBeNull();
  });

  it('writes "not recorded", never "normal"', () => {
    const table = extractionTable(extract([note({ id: 'n1', body: '体温 36.5' })]));
    // 書かれていないことと、正常だったことは違う
    expect(table).toContain('| 血圧 | 記載なし |');
    expect(table).not.toContain('異常なし');
    expect(table).toContain('| 体温 | 36.5 | n1 行 1 |');
  });

  it('carries the source for every value it did find', () => {
    const rows = extract([note({ id: 'n1', body: 'x\n脈拍 72' })]);
    const pulse = rows.find((r) => r.id === 'pulse')!;
    expect(pulse.noteId).toBe('n1');
    expect(pulse.line).toBe(2);
  });
});

describe('the line the agent must not cross', () => {
  const cited = citedLines([note({ id: 'n1', body: '高血圧症と診断されている' })]);

  it('stops a draft that decides a diagnosis', () => {
    const check = checkDraft('本日の所見から高血圧症と診断する', cited);
    expect(check.ok).toBe(false);
    expect(check.problems[0]).toContain('診断する');
  });

  it('stops a draft that decides treatment', () => {
    expect(checkDraft('降圧薬を投与する', cited).ok).toBe(false);
    expect(checkDraft('内服を中止する', cited).ok).toBe(false);
  });

  it('lets a quotation from the record through', () => {
    // 記録に書かれている診断を引用するのはよい。自分で付けるのが駄目。
    expect(checkDraft('高血圧症と診断されている', cited).ok).toBe(true);
  });

  it('lets an ordinary observation through', () => {
    expect(checkDraft('歩行時にふらつきあり\n食事は全量摂取', cited).ok).toBe(true);
  });
});

describe('reading a stored note', () => {
  it('does not call an unsigned note signed', () => {
    const entity = {
      id: 'n1',
      plugin_id: 'com.astra.ehr',
      entity_type: 'clinical_note',
      title: '記録',
      fields: { title: '記録', body: 'x' },
      source_task_id: null,
      source_meeting_id: null,
      created_at: '2026-08-27T00:00:00.000Z',
      updated_at: '2026-08-27T00:00:00.000Z',
    } as DomainEntity;
    expect(toClinicalNote(entity).signed).toBe(false);
  });
});
