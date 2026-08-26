/**
 * Sales CRM が dashboard へ出せるもの。Phase 4 §3.1 / Phase 5 §4。
 * **自分のテーブルは自分で引く**（実装仕様 §5.1、D-35）。
 */
import type { ResolvedValue } from '@astra/contracts';
import type { DomainService } from './domain.js';
import { nextBestActions, pipelineSummary } from './sales-crm.js';

const CRM_PLUGIN = 'com.astra.sales-crm';

export function salesCrmDataSources(
  domain: DomainService,
  now: () => Date = () => new Date(),
): Record<string, (tenantId: string) => Promise<ResolvedValue>> {
  const opportunities = (tenantId: string) =>
    domain.list(tenantId, CRM_PLUGIN, 'opportunity', 1_000);

  return {
    crm_by_stage: async (tenantId) => {
      const summary = pipelineSummary(await opportunities(tenantId));
      return {
        kind: 'series',
        // 定義の順のまま出す。並べ替えると段の位置が見るたび変わる。
        points: summary.map((s) => ({ label: s.stage, value: s.total })),
      };
    },

    crm_open_total: async (tenantId) => {
      const summary = pipelineSummary(await opportunities(tenantId));
      return {
        kind: 'count',
        value: summary.filter((s) => s.open).reduce((n, s) => n + s.total, 0),
      };
    },

    crm_stale: async (tenantId) => {
      const opps = await opportunities(tenantId);
      const withActivity = await Promise.all(
        opps.map(async (opportunity) => ({
          opportunity,
          activities: await domain.linked(tenantId, opportunity.id, 'activity'),
        })),
      );
      const actions = nextBestActions(withActivity, { now: now() });
      return {
        kind: 'rows',
        columns: ['商談', '次の一手', '理由'],
        rows: actions.map((a) => [a.opportunityName, a.what, a.why]),
      };
    },
  };
}
