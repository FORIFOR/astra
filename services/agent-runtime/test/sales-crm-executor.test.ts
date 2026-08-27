/**
 * Sales CRM の step。正本 §15.3。
 *
 * 見るのは:
 *   - 0 件を「0 円のパイプライン」として見せない
 *   - 根拠を落とさない
 *   - 外から取ってきたふりをしない
 */
import { describe, expect, it } from 'vitest';
import type { DomainEntity } from '@astra/contracts';
import { salesCrmExecutors } from '../src/sales-crm-executor.js';
import type { DomainService } from '../src/domain.js';

const entity = (
  id: string,
  entityType: string,
  title: string,
  fields: Record<string, unknown>,
): DomainEntity => ({
  id,
  plugin_id: 'com.astra.sales-crm',
  entity_type: entityType,
  title,
  fields,
  source_task_id: null,
  source_meeting_id: null,
  created_at: '2026-08-01T00:00:00.000Z',
  updated_at: '2026-08-01T00:00:00.000Z',
});

const opportunity = (over: Record<string, unknown> = {}): DomainEntity =>
  entity(`o-${String(over['name'] ?? 'x')}`, 'opportunity', String(over['name'] ?? '商談'), {
    name: '商談',
    stage: 'proposal',
    amount: 1_000_000,
    ...over,
  });

const activity = (id: string, occurredAt: string, summary: string): DomainEntity =>
  entity(id, 'activity', summary, { occurred_at: occurredAt, summary });

function domainWith(
  opportunities: readonly DomainEntity[],
  activities: Record<string, readonly DomainEntity[]> = {},
): DomainService {
  return {
    async list() {
      return [...opportunities];
    },
    async linked(_tenantId: string, fromId: string) {
      return [...(activities[fromId] ?? [])];
    },
  } as unknown as DomainService;
}

const task = { taskId: 't', tenantId: 'a', input: {} };
const step = { toolId: 'crm.pipeline', args: {} };
const NOW = (): Date => new Date('2026-08-27T00:00:00Z');

describe('the pipeline', () => {
  it('says there are none, rather than showing an empty pipeline worth zero', async () => {
    const executors = salesCrmExecutors(domainWith([]), NOW);
    const outcome = await executors['crm.pipeline']!.execute(task, step);

    expect(outcome.artifact!.markdown).toContain('1 件も登録されていません');
    expect(outcome.artifact!.markdown).not.toContain('進行中の合計');
  });

  it('keeps the stages in the order they are defined', async () => {
    const executors = salesCrmExecutors(
      domainWith([
        opportunity({ name: 'a', stage: 'won', amount: 5_000_000 }),
        opportunity({ name: 'b', stage: 'qualified', amount: 1 }),
      ]),
      NOW,
    );
    const markdown = (await executors['crm.pipeline']!.execute(task, step)).artifact!.markdown;
    // 金額順に並べ替えると、見るたびに段の位置が変わって読めない
    expect(markdown.indexOf('qualified')).toBeLessThan(markdown.indexOf('won'));
  });

  it('does not count closed deals as still in play', async () => {
    const executors = salesCrmExecutors(
      domainWith([
        opportunity({ name: 'a', stage: 'won', amount: 5_000_000 }),
        opportunity({ name: 'b', stage: 'proposal', amount: 2_000_000 }),
      ]),
      NOW,
    );
    const outcome = await executors['crm.pipeline']!.execute(task, step);
    expect((outcome.result as { open_total: number }).open_total).toBe(2_000_000);
  });
});

describe('the next action', () => {
  const staleStep = { toolId: 'crm.next_action', args: {} };

  it('says nothing needs doing, rather than staying silent', async () => {
    const fresh = opportunity({ name: 'fresh' });
    const executors = salesCrmExecutors(
      domainWith([fresh], { [fresh.id]: [activity('a1', '2026-08-26', '電話')] }),
      NOW,
    );
    const outcome = await executors['crm.next_action']!.execute(task, staleStep);
    // 「何もしなくてよい」と「調べていない」を混ぜない
    expect(outcome.artifact!.markdown).toContain('見当たりませんでした');
  });

  it('shows what it based the suggestion on', async () => {
    const stale = opportunity({ name: 'stale' });
    const executors = salesCrmExecutors(
      domainWith([stale], { [stale.id]: [activity('a1', '2026-07-01', '初回訪問')] }),
      NOW,
    );
    const markdown = (await executors['crm.next_action']!.execute(task, staleStep)).artifact!
      .markdown;

    expect(markdown).toContain('次の連絡を入れる');
    expect(markdown).toContain('日空いています');
    // 根拠を落とさない。落とすと、受け取った人が判断を確かめられない。
    expect(markdown).toContain('もとにした活動');
    expect(markdown).toContain('初回訪問');
  });

  it('treats having no activity at all as the reason itself', async () => {
    const empty = opportunity({ name: 'empty' });
    const executors = salesCrmExecutors(domainWith([empty]), NOW);
    const markdown = (await executors['crm.next_action']!.execute(task, staleStep)).artifact!
      .markdown;

    expect(markdown).toContain('最初の接触を記録する');
    expect(markdown).toContain('1 件も残っていません');
    expect(markdown).not.toContain('もとにした活動');
  });
});
