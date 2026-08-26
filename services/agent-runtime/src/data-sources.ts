/**
 * Sales CRM が dashboard へ出せるもの。Phase 4 §3.1 / Phase 5 §4。
 * **自分のテーブルは自分で引く**（実装仕様 §5.1、D-35）。
 */
import type { ResolvedValue } from '@astra/contracts';
import type { DomainService } from './domain.js';
import { nextBestActions, pipelineSummary } from './sales-crm.js';
import { toClip, totalDurationMs } from './video.js';

const CRM_PLUGIN = 'com.astra.sales-crm';
const VIDEO_PLUGIN = 'com.astra.video';

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

/**
 * Video が dashboard へ出せるもの。正本 §15.2（timeline/projects・render queue・assets）。
 *
 * **自分のテーブルは自分で引く**（実装仕様 §5.1、D-35）。
 */
export function videoDataSources(
  domain: DomainService,
): Record<string, (tenantId: string) => Promise<ResolvedValue>> {
  const projects = (tenantId: string) => domain.list(tenantId, VIDEO_PLUGIN, 'video_project', 500);
  const renders = (tenantId: string) => domain.list(tenantId, VIDEO_PLUGIN, 'render_job', 500);

  return {
    video_projects: async (tenantId) => {
      const rows = await Promise.all(
        (await projects(tenantId)).map(async (project) => {
          const clips = (await domain.linked(tenantId, project.id, 'video_clip')).map(toClip);
          const seconds = Math.round(totalDurationMs(clips) / 1000);
          return [
            String(project.fields['name'] ?? '無題'),
            `${clips.length} クリップ`,
            // 尺は秒で出す。ミリ秒は読む人の役に立たない。
            `${seconds} 秒`,
          ];
        }),
      );
      return { kind: 'rows', columns: ['プロジェクト', 'クリップ', '長さ'], rows };
    },

    video_render_queue: async (tenantId) => {
      const jobs = await renders(tenantId);
      return {
        kind: 'rows',
        columns: ['書き出し', '状態', '理由'],
        rows: jobs
          // 終わったものは待ち行列ではない
          .filter((job) => job.fields['status'] !== 'DONE')
          .map((job) => [
            String(job.fields['name'] ?? '無題'),
            String(job.fields['status'] ?? '不明'),
            // **失敗の理由を空欄にしない。**空欄だと、なぜ止まったか分からない
            String(job.fields['reason'] ?? ''),
          ]),
      };
    },

    video_assets: async (tenantId) => {
      const jobs = await renders(tenantId);
      return {
        kind: 'count',
        // 書き出せたものだけ数える。待ちや失敗を成果として数えない。
        value: jobs.filter((job) => job.fields['status'] === 'DONE').length,
      };
    },
  };
}
