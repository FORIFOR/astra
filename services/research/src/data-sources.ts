/**
 * research が dashboard へ出せるもの。Phase 4 実装仕様 §3.1。
 *
 * **自分のテーブルは自分で引く**（実装仕様 §5.1）。
 * plugin が指定できるのは名前だけで、中身はここが決める。
 */
import type { ResolvedValue } from '@astra/contracts';
import { withTenant, type DbHandle } from '@astra/db';

export function researchDataSources(
  db: DbHandle,
): Record<string, (tenantId: string) => Promise<ResolvedValue>> {
  return {
    research_runs: async (tenantId) => {
      const row = await withTenant(db, tenantId, (tx) =>
        tx
          .selectFrom('research_runs')
          .select(({ fn }) => [fn.countAll().as('n')])
          .executeTakeFirst(),
      );
      return { kind: 'count', value: Number(row?.n ?? 0) };
    },

    research_contradicted: async (tenantId) => {
      // 矛盾があった調査。確信度が low に落ちたものを数える。
      const row = await withTenant(db, tenantId, (tx) =>
        tx
          .selectFrom('research_runs')
          .select(({ fn }) => [fn.countAll().as('n')])
          .where('confidence', '=', 'low')
          .executeTakeFirst(),
      );
      return { kind: 'count', value: Number(row?.n ?? 0) };
    },

    research_by_confidence: async (tenantId) => {
      const rows = await withTenant(db, tenantId, (tx) =>
        tx
          .selectFrom('research_runs')
          .select(({ fn }) => ['confidence', fn.countAll().as('n')])
          .groupBy('confidence')
          .execute(),
      );
      return {
        kind: 'series',
        points: rows.map((r) => ({ label: r.confidence ?? '未評価', value: Number(r.n) })),
      };
    },

    research_recent: async (tenantId) => {
      const rows = await withTenant(db, tenantId, (tx) =>
        tx
          .selectFrom('research_runs')
          .select(['question', 'status', 'source_count', 'confidence'])
          .orderBy('id', 'desc')
          .limit(20)
          .execute(),
      );
      return {
        kind: 'rows',
        columns: ['質問', '状態', '出典', '確信度'],
        rows: rows.map((r) => [r.question, r.status, r.source_count, r.confidence]),
      };
    },
  };
}
