/**
 * Evidence Ledger の読み出し。UI/UX §15。
 *
 * **読むだけなので、検索も生成も要らない。**
 * ResearchService は SearchProvider と LanguageModel を要求するが、
 * 台帳を見せるだけの gateway にそれを持たせると、
 * 「読むために書く道具を用意する」ことになる。ここを db だけで切ってある。
 *
 * 表の持ち主は service-research のまま（実装仕様 §5.1）。
 */
import {
  AstraError,
  EvidenceLedger,
  countContradictionPairs,
  type SourceType,
} from '@astra/contracts';
import { withTenant, type DbHandle } from '@astra/db';

/** L1 の key claims に出す上限。多いほど「結論」に見えてしまう。 */
const KEY_CLAIM_LIMIT = 5;

export class ResearchLedgerService {
  readonly #db: DbHandle;

  constructor(db: DbHandle) {
    this.#db = db;
  }

  /**
   * L0 から L3 までを 1 度に返す。**段ごとに API を分けない。**
   * 分けると掘るたびに待ちが入り、Progressive Disclosure が
   * 「掘れるが遅いので誰も掘らない」ものになる。
   */
  async ledger(tenantId: string, taskId: string): Promise<EvidenceLedger> {
    return withTenant(this.#db, tenantId, async (tx) => {
      const run = await tx
        .selectFrom('research_runs')
        .select(['id', 'question', 'confidence'])
        .where('task_id', '=', taskId)
        .executeTakeFirst();
      // 調査でない仕事に、空の台帳を返さない。**無いことと空は違う。**
      if (!run) throw new AstraError('common.not_found', `no research run for task ${taskId}`);

      const rows = await tx
        .selectFrom('evidence')
        .selectAll()
        .where('research_run_id', '=', run.id)
        .orderBy('quality_score', 'desc')
        .orderBy('id', 'asc')
        .execute();

      const byType = new Map<SourceType, number>();
      for (const row of rows) {
        const type = row.source_type as SourceType;
        byType.set(type, (byType.get(type) ?? 0) + 1);
      }

      return EvidenceLedger.parse({
        task_id: taskId,
        question: run.question,
        // **同じ URL は 1 つと数える。**同じページを 3 回引いて「3 sources」にしない。
        source_count: new Set(rows.map((row) => row.source_url)).size,
        confidence: run.confidence ?? 'low',
        contradiction_count: countContradictionPairs(rows),
        groups: [...byType.entries()].map(([source_type, count]) => ({ source_type, count })),
        // 重みの大きい順に並んでいるので上から採る。作文しない。
        key_claims: rows.slice(0, KEY_CLAIM_LIMIT).map((row) => row.claim),
        items: rows.map((row) => ({
          id: row.id,
          claim: row.claim,
          source_url: row.source_url,
          source_type: row.source_type,
          publisher: row.publisher,
          published_at: row.published_at?.toISOString() ?? null,
          retrieved_at: row.retrieved_at.toISOString(),
          quality_score: Number(row.quality_score),
          freshness_score: Number(row.freshness_score),
          supports: row.supports,
          contradicts: row.contradicts,
        })),
      });
    });
  }
}
