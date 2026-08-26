/**
 * Sales CRM。正本 §15.3、Phase 5 実装仕様 §4。
 * ここは DB を要らない部分。**根拠を落とさない**性質を確かめる。
 */
import { describe, expect, it } from 'vitest';
import { uuidv7, validateFields, type DomainEntity } from '@astra/contracts';
import { SALES_CRM_ENTITIES, nextBestActions, pipelineSummary } from '../src/sales-crm.js';

const opportunity = (fields: Record<string, unknown>, title = '商談'): DomainEntity => ({
  id: uuidv7(),
  plugin_id: 'com.astra.crm',
  entity_type: 'opportunity',
  title,
  fields,
  source_task_id: null,
  source_meeting_id: null,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
});

const activity = (summary: string, occurredAt: string): DomainEntity => ({
  ...opportunity({ summary, occurred_at: occurredAt, kind: 'call' }, summary),
  entity_type: 'activity',
});

describe('the entity definitions', () => {
  it('refuses an opportunity without a stage', () => {
    const { problems } = validateFields(SALES_CRM_ENTITIES['opportunity']!, { name: 'A社' });
    expect(problems.map((p) => p.field)).toContain('stage');
  });

  it('refuses a stage that is not one of the defined ones', () => {
    const { problems } = validateFields(SALES_CRM_ENTITIES['opportunity']!, {
      name: 'A社',
      stage: 'maybe',
    });
    expect(problems.map((p) => p.field)).toEqual(['stage']);
  });

  it('drops a field the definition never mentioned', () => {
    // 通すと、plugin が任意の形を書き込めることになる
    const { fields } = validateFields(SALES_CRM_ENTITIES['opportunity']!, {
      name: 'A社',
      stage: 'lead',
      secret_backdoor: 'x',
    });
    expect(Object.keys(fields).sort()).toEqual(['name', 'stage']);
  });

  it('takes a number written as a string, but not a word', () => {
    expect(
      validateFields(SALES_CRM_ENTITIES['opportunity']!, {
        name: 'A社',
        stage: 'lead',
        amount: '1200000',
      }).fields['amount'],
    ).toBe(1_200_000);

    expect(
      validateFields(SALES_CRM_ENTITIES['opportunity']!, {
        name: 'A社',
        stage: 'lead',
        amount: 'たくさん',
      }).problems.map((p) => p.field),
    ).toEqual(['amount']);
  });

  it('refuses a date it cannot read', () => {
    expect(
      validateFields(SALES_CRM_ENTITIES['activity']!, {
        summary: '電話',
        kind: 'call',
        occurred_at: '来週あたり',
      }).problems.map((p) => p.field),
    ).toEqual(['occurred_at']);
  });
});

describe('pipelineSummary', () => {
  it('keeps the stages in the order they were defined', () => {
    // 金額順に並べると、見るたびに段の位置が変わって読めない
    const summary = pipelineSummary([
      opportunity({ stage: 'won', amount: 900 }),
      opportunity({ stage: 'lead', amount: 100 }),
    ]);
    expect(summary.map((s) => s.stage)).toEqual(['lead', 'qualified', 'proposal', 'won', 'lost']);
  });

  it('counts and totals per stage, and says which are still open', () => {
    const summary = pipelineSummary([
      opportunity({ stage: 'lead', amount: 100 }),
      opportunity({ stage: 'lead', amount: 200 }),
      opportunity({ stage: 'won', amount: 900 }),
    ]);
    const lead = summary.find((s) => s.stage === 'lead')!;
    expect(lead).toMatchObject({ count: 2, total: 300, open: true });
    expect(summary.find((s) => s.stage === 'won')!.open).toBe(false);
  });

  it('does not count a stage the definition does not have', () => {
    // 混ぜると合計が意味を持たなくなる
    const summary = pipelineSummary([opportunity({ stage: 'invented', amount: 5_000 })]);
    expect(summary.reduce((n, s) => n + s.count, 0)).toBe(0);
  });

  it('tolerates an opportunity with no amount', () => {
    const summary = pipelineSummary([opportunity({ stage: 'lead' })]);
    expect(summary.find((s) => s.stage === 'lead')).toMatchObject({ count: 1, total: 0 });
  });
});

describe('nextBestActions', () => {
  const now = new Date('2026-08-26T00:00:00.000Z');

  it('never proposes something without saying why', () => {
    const opp = opportunity({ stage: 'proposal', name: 'A社' }, 'A社 提案');
    const actions = nextBestActions(
      [{ opportunity: opp, activities: [activity('見積を送付', '2026-07-01T00:00:00.000Z')] }],
      { now },
    );
    expect(actions).toHaveLength(1);
    expect(actions[0]!.why).toMatch(/\d+ 日/);
    // 根拠になった活動から辿れる（AC5-9）
    expect(actions[0]!.evidence[0]!.summary).toBe('見積を送付');
  });

  it('says so plainly when there is no activity at all', () => {
    // 「活動が無い」こと自体が根拠なので、作り話で埋めない
    const actions = nextBestActions(
      [{ opportunity: opportunity({ stage: 'lead' }, 'B社'), activities: [] }],
      { now },
    );
    expect(actions[0]!.why).toContain('1 件も残っていません');
    expect(actions[0]!.evidence).toEqual([]);
  });

  it('leaves a recently touched opportunity alone', () => {
    const actions = nextBestActions(
      [
        {
          opportunity: opportunity({ stage: 'proposal' }, 'C社'),
          activities: [activity('電話', '2026-08-25T00:00:00.000Z')],
        },
      ],
      { now },
    );
    expect(actions).toEqual([]);
  });

  it('has nothing to propose for a closed deal', () => {
    for (const stage of ['won', 'lost']) {
      expect(
        nextBestActions([{ opportunity: opportunity({ stage }), activities: [] }], { now }),
      ).toEqual([]);
    }
  });

  it('ignores an activity whose date cannot be read', () => {
    const actions = nextBestActions(
      [
        {
          opportunity: opportunity({ stage: 'lead' }, 'D社'),
          activities: [activity('いつか', 'そのうち')],
        },
      ],
      { now },
    );
    // 日付が読めない活動は「活動なし」として扱う。推測しない。
    expect(actions[0]!.why).toContain('1 件も残っていません');
  });

  it('puts the most neglected first, and is stable when they tie', () => {
    const actions = nextBestActions(
      [
        {
          opportunity: opportunity({ stage: 'lead' }, 'Z社'),
          activities: [activity('電話', '2026-08-01T00:00:00.000Z')],
        },
        {
          opportunity: opportunity({ stage: 'lead' }, 'A社'),
          activities: [activity('電話', '2026-07-01T00:00:00.000Z')],
        },
      ],
      { now },
    );
    expect(actions.map((a) => a.opportunityName)).toEqual(['A社', 'Z社']);
  });
});
