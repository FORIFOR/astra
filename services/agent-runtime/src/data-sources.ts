/**
 * Sales CRM が dashboard へ出せるもの。Phase 4 §3.1 / Phase 5 §4。
 * **自分のテーブルは自分で引く**（実装仕様 §5.1、D-35）。
 */
import type { ResolvedValue } from '@astra/contracts';
import type { DomainService } from './domain.js';
import { nextBestActions, pipelineSummary } from './sales-crm.js';
import { toClip, totalDurationMs } from './video.js';
import { reviewsDue } from './care.js';
import { issueGaps, latestRevisions, openRfis, toRevision, toRfi } from './architecture.js';
import { concentration, toPosition } from './stock.js';

const CRM_PLUGIN = 'com.astra.sales-crm';
const VIDEO_PLUGIN = 'com.astra.video';
const CARE_PLUGIN = 'com.astra.care';
const EHR_PLUGIN = 'com.astra.ehr';
const ARCH_PLUGIN = 'com.astra.architecture';
const STOCK_PLUGIN = 'com.astra.stock';

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
            /*
             * **失敗の理由を空欄にしない。**空欄だと、なぜ止まったか分からない。
             * 「理由が記録されていない」ことも、それ自体が伝えるべきこと。
             */
            reasonFor(job.fields['reason'], String(job.fields['status'] ?? '')),
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

/**
 * Care Support が dashboard へ出せるもの。正本 §15.4。
 *
 * **数えるだけ。良し悪しを判断しない。**
 */
export function careDataSources(
  domain: DomainService,
  now: () => Date = () => new Date(),
): Record<string, (tenantId: string) => Promise<ResolvedValue>> {
  const nameOf = async (tenantId: string, id: string | undefined): Promise<string> => {
    if (typeof id !== 'string' || id.length === 0) return '不明';
    const entity = await domain.get(tenantId, id).catch(() => null);
    // 引けなかったものを、それらしい名前で埋めない
    return entity ? String(entity.fields['name'] ?? '不明') : '不明';
  };

  return {
    care_residents: async (tenantId) => ({
      kind: 'count',
      value: (await domain.list(tenantId, CARE_PLUGIN, 'resident', 1_000)).length,
    }),

    care_open_incidents: async (tenantId) => {
      const incidents = await domain.list(tenantId, CARE_PLUGIN, 'incident', 500);
      const rows = await Promise.all(
        incidents
          // 閉じたものは待ちではない
          .filter((incident) => incident.fields['status'] !== 'CLOSED')
          .map(async (incident) => [
            String(incident.fields['title'] ?? '無題'),
            await nameOf(tenantId, incident.fields['resident'] as string | undefined),
            String(incident.fields['status'] ?? 'DRAFT'),
          ]),
      );
      return { kind: 'rows', columns: ['記録', '対象', '状態'], rows };
    },

    care_plan_review_due: async (tenantId) => {
      const plans = await domain.list(tenantId, CARE_PLUGIN, 'care_plan', 500);
      const resolved = await Promise.all(
        plans.map(async (plan) => ({
          title: String(plan.fields['title'] ?? '無題'),
          residentName: await nameOf(tenantId, plan.fields['resident'] as string | undefined),
          reviewDue:
            typeof plan.fields['review_due'] === 'string' ? plan.fields['review_due'] : null,
        })),
      );
      return {
        kind: 'rows',
        columns: ['プラン', '対象', '期日'],
        rows: reviewsDue(resolved, now()).map((due) => [
          due.title,
          due.residentName,
          // 期日が無いことを空欄にしない。空欄だと見落とす。
          due.dueAt === null ? '期日が入っていません' : `残り ${due.daysLeft} 日`,
        ]),
      };
    },
  };
}

/**
 * EHR が dashboard へ出せるもの。正本 §15.5。
 *
 * **未署名の下書きを数える。**署名されていないものが溜まっていることは、
 * 見えていなければならない。
 */
export function ehrDataSources(
  domain: DomainService,
): Record<string, (tenantId: string) => Promise<ResolvedValue>> {
  return {
    ehr_encounters: async (tenantId) => ({
      kind: 'count',
      value: (await domain.list(tenantId, EHR_PLUGIN, 'encounter', 1_000)).length,
    }),

    ehr_unsigned_drafts: async (tenantId) => {
      const notes = await domain.list(tenantId, EHR_PLUGIN, 'clinical_note', 500);
      return {
        kind: 'rows',
        columns: ['記録', '書いた人'],
        rows: notes
          // 署名の記録が無いものは未署名として扱う。署名済みに寄せない。
          .filter((note) => note.fields['signed'] !== true)
          .map((note) => [
            String(note.fields['title'] ?? '無題'),
            String(note.fields['author'] ?? '不明'),
          ]),
      };
    },
  };
}

/**
 * Architecture が dashboard へ出せるもの。正本 §15.6。
 *
 * **決められないことを、決めたことにしない。**
 */
export function architectureDataSources(
  domain: DomainService,
  now: () => Date = () => new Date(),
): Record<string, (tenantId: string) => Promise<ResolvedValue>> {
  const nameOf = async (tenantId: string, id: string): Promise<string> => {
    const entity = await domain.get(tenantId, id).catch(() => null);
    return entity ? String(entity.fields['name'] ?? id) : id;
  };

  return {
    arch_projects: async (tenantId) => {
      const projects = await domain.list(tenantId, ARCH_PLUGIN, 'arch_project', 500);
      return {
        kind: 'rows',
        columns: ['案件', '段階', '施主'],
        rows: projects.map((project) => [
          String(project.fields['name'] ?? '無題'),
          // 入っていないことを空欄にしない
          String(project.fields['phase'] ?? '未設定'),
          String(project.fields['client'] ?? '未設定'),
        ]),
      };
    },

    arch_latest_revisions: async (tenantId) => {
      const revisions = (await domain.list(tenantId, ARCH_PLUGIN, 'revision', 1_000)).map(
        toRevision,
      );
      const rows = await Promise.all(
        latestRevisions(revisions).map(async (drawing) => [
          await nameOf(tenantId, drawing.drawingId),
          drawing.revisions.length === 0
            ? '発行日なし'
            : drawing.revisions.map((r) => r.label).join('・'),
          // 同じ日に複数あることを黙らない
          drawing.ambiguous ? '同日に複数' : '',
        ]),
      );
      return { kind: 'rows', columns: ['図面', '最新', '注意'], rows };
    },

    arch_open_rfis: async (tenantId) => {
      const rfis = (await domain.list(tenantId, ARCH_PLUGIN, 'rfi', 500)).map(toRfi);
      return {
        kind: 'rows',
        columns: ['質疑', '期限'],
        rows: openRfis(rfis, now()).map((rfi) => [
          rfi.question,
          rfi.daysLeft === null
            ? '期限が入っていません'
            : rfi.daysLeft < 0
              ? `${-rfi.daysLeft} 日超過`
              : `残り ${rfi.daysLeft} 日`,
        ]),
      };
    },

    arch_open_issue_count: async (tenantId) => {
      const issues = await domain.list(tenantId, ARCH_PLUGIN, 'arch_issue', 500);
      return {
        kind: 'count',
        // 開いているものを数える。抜けの有無ではなく、未解決の数。
        value: issues.filter((issue) => issue.fields['status'] !== 'CLOSED').length,
      };
    },
  };
}

/**
 * Stock が dashboard へ出せるもの。正本 §15.7。
 *
 * **割合を出せないときは、出せないと書く。**
 */
export function stockDataSources(
  domain: DomainService,
): Record<string, (tenantId: string) => Promise<ResolvedValue>> {
  return {
    stock_watchlist: async (tenantId) => {
      const items = await domain.list(tenantId, STOCK_PLUGIN, 'watch_item', 500);
      return {
        kind: 'rows',
        columns: ['銘柄', '名前', '最終確認'],
        rows: items.map((item) => [
          String(item.fields['symbol'] ?? '不明'),
          String(item.fields['name'] ?? ''),
          // 見ていないことを、最近見たことにしない
          typeof item.fields['last_reviewed_at'] === 'string'
            ? String(item.fields['last_reviewed_at'])
            : '未確認',
        ]),
      };
    },

    stock_positions: async (tenantId) => {
      const positions = (await domain.list(tenantId, STOCK_PLUGIN, 'position', 500)).map(
        toPosition,
      );
      return {
        kind: 'rows',
        columns: ['銘柄', '数量', '割合'],
        rows: concentration(positions).map((row) => [
          row.symbol,
          String(positions.find((p) => p.symbol === row.symbol)?.quantity ?? 0),
          row.share === null ? '取得単価が未入力' : `${(row.share * 100).toFixed(1)}%`,
        ]),
      };
    },

    stock_draft_orders: async (tenantId) => {
      const drafts = await domain.list(tenantId, STOCK_PLUGIN, 'order_draft', 500);
      return {
        kind: 'count',
        // 取り消したものは待ちではない
        value: drafts.filter((draft) => draft.fields['status'] === 'DRAFT').length,
      };
    },
  };
}

/**
 * 書き出しの理由欄。
 *
 * 失敗しているのに理由が無いのと、まだ動いているので理由が無いのは違う。
 * **同じ空欄で見せない。**
 */
function reasonFor(value: unknown, status: string): string {
  if (typeof value === 'string' && value.length > 0) return value;
  return status === 'FAILED' ? '理由が記録されていません' : '—';
}
