/**
 * Sales CRM の step を task-service へ差し込む。正本 §15.3。
 *
 * この executor が無かった間、manifest は `crm.pipeline` と
 * `crm.next_action` を宣言していたのに実装が無く、走らせると
 * **`{ echoed: null }` を返して「完了」していた。**
 * 画面には完了と出て、成果物は無い。
 * 宣言したものは、実装するか、繋がっていないと言うかのどちらかにする。
 *
 * ここが扱うのは**手元の記録だけ**。外部 CRM（Salesforce 等）への接続は
 * 未決（OQ-20）なので、外から取ってきたふりはしない。
 */
import type { DomainService } from './domain.js';
import {
  nextBestActions,
  pipelineSummary,
  type NextBestAction,
  type PipelineStage,
} from './sales-crm.js';

const CRM_PLUGIN = 'com.astra.sales-crm';

interface TaskLike {
  readonly taskId: string;
  readonly tenantId: string;
  readonly input: Record<string, unknown>;
}

interface StepLike {
  readonly toolId: string;
  readonly args: Record<string, unknown>;
}

export interface CrmExecutorResult {
  result: unknown;
  detail?: string | null;
  artifact?: { title: string; markdown: string };
}

type Executor = { execute(input: TaskLike, step: StepLike): Promise<CrmExecutorResult> };

/** 金額の見せ方。**桁を落とさない。**丸めると合計が合わなくなる。 */
function money(value: number): string {
  return value.toLocaleString('ja-JP');
}

function pipelineMarkdown(stages: readonly PipelineStage[]): string {
  const open = stages.filter((s) => s.open);
  const total = open.reduce((n, s) => n + s.total, 0);

  if (stages.every((s) => s.count === 0)) {
    // 0 件を「0 円のパイプライン」として見せない
    return '商談がまだ 1 件も登録されていません。';
  }

  return [
    '# 商談の状況',
    '',
    '| 段階 | 件数 | 金額 |',
    '| --- | ---: | ---: |',
    // 定義の順のまま出す。金額順に並べ替えると、見るたびに段の位置が変わる。
    ...stages.map((s) => `| ${s.stage} | ${String(s.count)} | ${money(s.total)} |`),
    '',
    `進行中の合計: ${money(total)}`,
  ].join('\n');
}

function actionsMarkdown(actions: readonly NextBestAction[]): string {
  if (actions.length === 0) {
    // 「何もしなくてよい」と「調べていない」を混ぜない
    return '手を打つべき商談は見当たりませんでした。';
  }

  return [
    '# 次の一手',
    '',
    ...actions.flatMap((action) => [
      `## ${action.opportunityName}`,
      '',
      `- ${action.what}`,
      `- 理由: ${action.why}`,
      /*
       * **根拠を落とさない。**「そろそろ連絡した方がよい」だけでは、
       * 受け取った人がその判断を確かめられない。
       * 根拠が無いときは「根拠なし」ではなく、無いことを理由に書いてある。
       */
      ...(action.evidence.length > 0
        ? ['- もとにした活動:', ...action.evidence.map((e) => `  - ${e.occurredAt}: ${e.summary}`)]
        : []),
      '',
    ]),
  ].join('\n');
}

export function salesCrmExecutors(
  domain: DomainService,
  now: () => Date = () => new Date(),
): Record<string, Executor> {
  const opportunities = (tenantId: string): Promise<import('@astra/contracts').DomainEntity[]> =>
    domain.list(tenantId, CRM_PLUGIN, 'opportunity', 500);

  return {
    'crm.pipeline': {
      async execute(input) {
        const stages = pipelineSummary(await opportunities(input.tenantId));
        const open = stages.filter((s) => s.open);

        return {
          result: {
            stages: stages.map((s) => ({ stage: s.stage, count: s.count, total: s.total })),
            open_total: open.reduce((n, s) => n + s.total, 0),
          },
          detail: `${String(stages.reduce((n, s) => n + s.count, 0))} 件の商談`,
          artifact: { title: '商談の状況', markdown: pipelineMarkdown(stages) },
        };
      },
    },

    'crm.next_action': {
      async execute(input) {
        const opps = await opportunities(input.tenantId);
        const withActivity = await Promise.all(
          opps.map(async (opportunity) => ({
            opportunity,
            activities: await domain.linked(input.tenantId, opportunity.id, 'activity'),
          })),
        );
        const actions = nextBestActions(withActivity, { now: now() });

        return {
          result: { actions: actions.length },
          detail:
            actions.length === 0 ? '手を打つべき商談はありません' : `${String(actions.length)} 件`,
          artifact: { title: '次の一手', markdown: actionsMarkdown(actions) },
        };
      },
    },
  };
}
