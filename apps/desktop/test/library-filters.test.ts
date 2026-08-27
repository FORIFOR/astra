/** Library の絞り込みと来歴（UI/UX §10.1・§10.2）。 */
import { describe, expect, it } from 'vitest';
import type { Artifact } from '@astra/contracts';
import {
  EMPTY_FILTERS,
  activeFilterCount,
  filterOptions,
  generatedByLabel,
  lineageOf,
  matchesFilters,
} from '../src/library/filters.js';

const now = Date.parse('2026-08-27T12:00:00+09:00');
const art = (over: Record<string, unknown>): Artifact =>
  ({
    id: 'a',
    tags: [],
    source_agent_id: 'com.astra.research',
    parent_artifact_id: null,
    sensitivity: 'PRIVATE',
    created_at: '2026-08-27T09:00:00+09:00',
    ...over,
  }) as unknown as Artifact;

describe('filterOptions', () => {
  it('offers only what the artifacts actually carry', () => {
    const o = filterOptions([
      art({ id: '1', tags: ['project:A社', 'person:田中'] }),
      art({ id: '2', source_agent_id: null, sensitivity: 'CONFIDENTIAL' }),
    ]);
    expect(o.projects).toEqual(['A社']);
    expect(o.people).toEqual(['田中']);
    expect(o.generatedBy.map((g) => g.label)).toEqual(['調べもの', '手で追加']);
    expect(o.sensitivities).toEqual(['CONFIDENTIAL']);
  });
});

describe('matchesFilters', () => {
  it('matches everything with no filter', () => {
    expect(matchesFilters(art({}), EMPTY_FILTERS, now)).toBe(true);
    expect(activeFilterCount(EMPTY_FILTERS)).toBe(0);
  });

  it('narrows by project, person, date, author and sensitivity', () => {
    const a = art({ tags: ['project:A社', 'person:田中'], sensitivity: 'CONFIDENTIAL' });
    expect(matchesFilters(a, { ...EMPTY_FILTERS, project: 'A社' }, now)).toBe(true);
    expect(matchesFilters(a, { ...EMPTY_FILTERS, project: 'B社' }, now)).toBe(false);
    expect(matchesFilters(a, { ...EMPTY_FILTERS, person: '田中' }, now)).toBe(true);
    expect(matchesFilters(a, { ...EMPTY_FILTERS, date: 'today' }, now)).toBe(true);
    expect(
      matchesFilters(
        art({ created_at: '2026-07-01T00:00:00+09:00' }),
        { ...EMPTY_FILTERS, date: '30d' },
        now,
      ),
    ).toBe(false);
    expect(matchesFilters(a, { ...EMPTY_FILTERS, generatedBy: 'com.astra.research' }, now)).toBe(
      true,
    );
    expect(matchesFilters(a, { ...EMPTY_FILTERS, generatedBy: 'manual' }, now)).toBe(false);
    expect(matchesFilters(a, { ...EMPTY_FILTERS, sensitivity: 'CONFIDENTIAL' }, now)).toBe(true);
    expect(activeFilterCount({ ...EMPTY_FILTERS, project: 'A社', date: '7d' })).toBe(2);
  });
});

describe('lineageOf', () => {
  it('walks the parent chain nearest first and never loops', () => {
    const v5 = art({ id: 'v5', parent_artifact_id: 'v4' });
    const v4 = art({ id: 'v4', parent_artifact_id: 'm' });
    const m = art({ id: 'm', parent_artifact_id: 'v5' });
    expect(lineageOf(v5, [v5, v4, m]).map((a) => a.id)).toEqual(['v4', 'm']);
  });

  it('names who made it without leaking ids', () => {
    expect(generatedByLabel('com.astra.research')).toBe('調べもの');
    expect(generatedByLabel(null)).toBe('手で追加');
    expect(generatedByLabel('com.example.custom')).toBe('custom');
  });
});
