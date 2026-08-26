/**
 * World Model。正本 §10、Phase 6 実装仕様 §2・§3。
 *
 * 「ユーザーの世界の現在状態」を持つ。会話ログではない。
 */
import {
  AstraError,
  normalizeName,
  uuidv7,
  type CommitmentStatus,
  type FactSource,
  type WorldEntity,
  type WorldEntityKind,
  type WorldFact,
  type WorldRelation,
} from '@astra/contracts';
import { withTenant, type DbHandle } from '@astra/db';
import { shouldRemember, type MemoryCandidate } from './memory.js';

export interface WorldDeps {
  readonly db: DbHandle;
  readonly now?: () => Date;
}

export interface RememberResult {
  readonly fact: WorldFact | null;
  /** 書かなかった理由。**黙って捨てない**（memory.ts の注記）。 */
  readonly skipped: string | null;
}

export class WorldModelService {
  readonly #db: DbHandle;
  readonly #now: () => Date;

  constructor(deps: WorldDeps) {
    this.#db = deps.db;
    this.#now = deps.now ?? (() => new Date());
  }

  /**
   * entity を寄せる。同じ人を二度作らない（D-45）。
   *
   * 既にあれば `mention_count` を増やす。「よく出てくる人・案件」の
   * 判定は、この回数でしかできない。
   */
  async observe(
    tenantId: string,
    kind: WorldEntityKind,
    name: string,
    attributes: Record<string, unknown> = {},
  ): Promise<WorldEntity> {
    const normalized = normalizeName(name);
    if (normalized.length === 0) {
      throw new AstraError('common.validation_failed', 'an entity needs a name');
    }
    const at = this.#now();

    const row = await withTenant(this.#db, tenantId, (tx) =>
      tx
        .insertInto('world_entities')
        .values({
          id: uuidv7(),
          tenant_id: tenantId,
          kind,
          name,
          normalized_name: normalized,
          mention_count: 1,
          attributes: JSON.stringify(attributes),
          first_seen_at: at,
          last_seen_at: at,
        })
        .onConflict((oc) =>
          oc.columns(['tenant_id', 'kind', 'normalized_name']).doUpdateSet((eb) => ({
            mention_count: eb('world_entities.mention_count', '+', 1),
            last_seen_at: at,
          })),
        )
        .returningAll()
        .executeTakeFirstOrThrow(),
    );
    return toEntity(row);
  }

  async relate(
    tenantId: string,
    fromId: string,
    toId: string,
    relation: WorldRelation,
    weight = 1,
  ): Promise<void> {
    await withTenant(this.#db, tenantId, (tx) =>
      tx
        .insertInto('world_edges')
        .values({
          tenant_id: tenantId,
          from_id: fromId,
          to_id: toId,
          relation,
          weight: String(weight),
        })
        .onConflict((oc) => oc.doNothing())
        .execute(),
    );
  }

  async neighbours(
    tenantId: string,
    entityId: string,
    relation?: WorldRelation,
  ): Promise<WorldEntity[]> {
    const rows = await withTenant(this.#db, tenantId, (tx) => {
      let query = tx
        .selectFrom('world_edges')
        .innerJoin('world_entities', 'world_entities.id', 'world_edges.to_id')
        .selectAll('world_entities')
        .where('world_edges.from_id', '=', entityId);
      if (relation) query = query.where('world_edges.relation', '=', relation);
      return query.execute();
    });
    return rows.map(toEntity);
  }

  /**
   * 覚える。**方針に合わないものは書かない**（正本 §10.3）。
   *
   * 書かなかったときは理由を返す。黙って捨てると、
   * 「なぜ覚えていないのか」を後から説明できなくなる。
   */
  async remember(
    tenantId: string,
    candidate: MemoryCandidate & {
      readonly subjectEntityId?: string | null;
      readonly dueAt?: string | null;
    },
  ): Promise<RememberResult> {
    const verdict = shouldRemember(candidate);
    if (!verdict.write) return { fact: null, skipped: verdict.reason };

    const at = this.#now();
    const row = await withTenant(this.#db, tenantId, (tx) =>
      tx
        .insertInto('world_facts')
        .values({
          id: uuidv7(),
          tenant_id: tenantId,
          kind: verdict.kind,
          statement: candidate.statement.trim(),
          subject_entity_id: candidate.subjectEntityId ?? null,
          source: JSON.stringify(candidate.source),
          status: verdict.kind === 'commitment' ? 'OPEN' : null,
          due_at: candidate.dueAt ? new Date(candidate.dueAt) : null,
          confidence: String(verdict.confidence),
          created_at: at,
          updated_at: at,
        })
        // 同じ出所から同じ文を二度覚えない
        .onConflict((oc) => oc.doNothing())
        .returningAll()
        .executeTakeFirst(),
    );

    if (!row) {
      // 既に覚えている。落としたわけではないので、そう言う。
      return { fact: null, skipped: 'already remembered from the same source' };
    }
    return { fact: toFact(row), skipped: null };
  }

  /** 未了の commitment。済んだものは返さない（AC6-3）。 */
  async openCommitments(tenantId: string, limit = 100): Promise<WorldFact[]> {
    const rows = await withTenant(this.#db, tenantId, (tx) =>
      tx
        .selectFrom('world_facts')
        .selectAll()
        .where('kind', '=', 'commitment')
        .where('status', '=', 'OPEN')
        // 期限のあるものを先に。無いものは後ろ。
        .orderBy('due_at', 'asc')
        .limit(limit)
        .execute(),
    );
    return rows.map(toFact);
  }

  /** 済ませる / やめる。**消さずに残す。**「やらないことにした」も記録。 */
  async settle(
    tenantId: string,
    factId: string,
    status: Exclude<CommitmentStatus, 'OPEN'>,
  ): Promise<WorldFact> {
    const row = await withTenant(this.#db, tenantId, (tx) =>
      tx
        .updateTable('world_facts')
        .set({ status, updated_at: this.#now() })
        .where('id', '=', factId)
        .where('kind', '=', 'commitment')
        .returningAll()
        .executeTakeFirst(),
    );
    if (!row) throw new AstraError('common.not_found', 'no such commitment');
    return toFact(row);
  }

  /** いつ何が起きたか。書き換えない。 */
  async record(
    tenantId: string,
    kind: string,
    payload: Record<string, unknown>,
    entityId?: string | null,
  ): Promise<void> {
    await withTenant(this.#db, tenantId, (tx) =>
      tx
        .insertInto('world_events')
        .values({
          id: uuidv7(),
          tenant_id: tenantId,
          entity_id: entityId ?? null,
          kind,
          payload: JSON.stringify(payload),
          occurred_at: this.#now(),
        })
        .execute(),
    );
  }
}

function toEntity(row: Record<string, unknown>): WorldEntity {
  const iso = (v: unknown): string => (v instanceof Date ? v.toISOString() : String(v));
  return {
    id: row['id'] as string,
    tenant_id: row['tenant_id'] as string,
    kind: row['kind'] as WorldEntityKind,
    name: row['name'] as string,
    normalized_name: row['normalized_name'] as string,
    mention_count: Number(row['mention_count']),
    attributes: (row['attributes'] ?? {}) as Record<string, unknown>,
    first_seen_at: iso(row['first_seen_at']),
    last_seen_at: iso(row['last_seen_at']),
  } as WorldEntity;
}

function toFact(row: Record<string, unknown>): WorldFact {
  const iso = (v: unknown): string | null => (v instanceof Date ? v.toISOString() : null);
  return {
    id: row['id'] as string,
    tenant_id: row['tenant_id'] as string,
    kind: row['kind'],
    statement: row['statement'] as string,
    subject_entity_id: (row['subject_entity_id'] ?? null) as string | null,
    source: row['source'] as FactSource,
    status: (row['status'] ?? null) as CommitmentStatus | null,
    due_at: iso(row['due_at']),
    confidence: Number(row['confidence']),
    created_at: iso(row['created_at']),
    updated_at: iso(row['updated_at']),
  } as WorldFact;
}
