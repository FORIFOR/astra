/**
 * meeting が dashboard へ出せるもの。Phase 4 実装仕様 §3.1。
 * 自分のテーブルは自分で引く（実装仕様 §5.1）。
 */
import type { ResolvedValue } from '@astra/contracts';
import { withTenant, type DbHandle } from '@astra/db';

export function meetingDataSources(
  db: DbHandle,
): Record<string, (tenantId: string) => Promise<ResolvedValue>> {
  return {
    meetings: async (tenantId) => {
      const row = await withTenant(db, tenantId, (tx) =>
        tx
          .selectFrom('meetings')
          .select(({ fn }) => [fn.countAll().as('n')])
          .executeTakeFirst(),
      );
      return { kind: 'count', value: Number(row?.n ?? 0) };
    },

    meetings_finalizing: async (tenantId) => {
      const row = await withTenant(db, tenantId, (tx) =>
        tx
          .selectFrom('meetings')
          .select(({ fn }) => [fn.countAll().as('n')])
          .where('status', '=', 'FINALIZING')
          .executeTakeFirst(),
      );
      return { kind: 'count', value: Number(row?.n ?? 0) };
    },

    meetings_recent: async (tenantId) => {
      const rows = await withTenant(db, tenantId, (tx) =>
        tx
          .selectFrom('meetings')
          .select(['title', 'status', 'started_at'])
          .orderBy('started_at', 'desc')
          .limit(20)
          .execute(),
      );
      return {
        kind: 'rows',
        columns: ['会議', '状態', '開始'],
        rows: rows.map((r) => [r.title, r.status, r.started_at.toISOString()]),
      };
    },
  };
}
