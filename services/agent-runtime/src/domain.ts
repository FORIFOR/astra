/**
 * Plugin が持ち込んだ entity の保管と集計。Phase 5 実装仕様 §3・§4。
 *
 * 実体は単一表に jsonb で入る（D-41）。**plugin ごとに DDL を走らせない。**
 * 型の検査は契約側（`validateFields`）が行い、ここは保存と読み出しに徹する。
 */
import {
  AstraError,
  titleOf,
  uuidv7,
  validateFields,
  type DomainEntity,
  type EntityDef,
} from '@astra/contracts';
import { withTenant, type DbHandle } from '@astra/db';

export interface DomainDeps {
  readonly db: DbHandle;
  readonly now?: () => Date;
}

export interface CreateEntityInput {
  readonly tenantId: string;
  readonly userId: string;
  readonly pluginId: string;
  readonly def: EntityDef;
  readonly fields: Record<string, unknown>;
  readonly sourceTaskId?: string | null;
  readonly sourceMeetingId?: string | null;
}

export class DomainService {
  readonly #db: DbHandle;
  readonly #now: () => Date;

  constructor(deps: DomainDeps) {
    this.#db = deps.db;
    this.#now = deps.now ?? (() => new Date());
  }

  /** 定義に合わない値は保存しない。**壊れた entity を作らせない。** */
  async create(input: CreateEntityInput): Promise<DomainEntity> {
    const { fields, problems } = validateFields(input.def, input.fields);
    if (problems.length > 0) {
      throw new AstraError('common.validation_failed', `invalid ${input.def.id}`, {
        details: problems,
      });
    }

    const id = uuidv7();
    const at = this.#now();
    const row = await withTenant(this.#db, input.tenantId, (tx) =>
      tx
        .insertInto('domain_entities')
        .values({
          id,
          tenant_id: input.tenantId,
          plugin_id: input.pluginId,
          entity_type: input.def.id,
          title: titleOf(input.def, fields),
          fields: JSON.stringify(fields),
          source_task_id: input.sourceTaskId ?? null,
          source_meeting_id: input.sourceMeetingId ?? null,
          created_by: input.userId,
          created_at: at,
          updated_at: at,
        })
        .returningAll()
        .executeTakeFirstOrThrow(),
    );
    return toEntity(row);
  }

  async list(
    tenantId: string,
    pluginId: string,
    entityType: string,
    limit = 100,
  ): Promise<DomainEntity[]> {
    const rows = await withTenant(this.#db, tenantId, (tx) =>
      tx
        .selectFrom('domain_entities')
        .selectAll()
        .where('plugin_id', '=', pluginId)
        .where('entity_type', '=', entityType)
        .orderBy('id', 'desc')
        .limit(limit)
        .execute(),
    );
    return rows.map(toEntity);
  }

  async get(tenantId: string, id: string): Promise<DomainEntity> {
    const row = await withTenant(this.#db, tenantId, (tx) =>
      tx.selectFrom('domain_entities').selectAll().where('id', '=', id).executeTakeFirst(),
    );
    // 別テナントのものは「無い」（AC5-10）
    if (!row) throw new AstraError('common.not_found', 'entity not found');
    return toEntity(row);
  }

  /** entity どうしを結ぶ。商談 → 活動 のような紐づけ。 */
  async link(tenantId: string, fromId: string, toId: string, relation: string): Promise<void> {
    await withTenant(this.#db, tenantId, (tx) =>
      tx
        .insertInto('domain_links')
        .values({ tenant_id: tenantId, from_id: fromId, to_id: toId, relation })
        .onConflict((oc) => oc.doNothing())
        .execute(),
    );
  }

  async linked(tenantId: string, fromId: string, relation: string): Promise<DomainEntity[]> {
    const rows = await withTenant(this.#db, tenantId, (tx) =>
      tx
        .selectFrom('domain_links')
        .innerJoin('domain_entities', 'domain_entities.id', 'domain_links.to_id')
        .selectAll('domain_entities')
        .where('domain_links.from_id', '=', fromId)
        .where('domain_links.relation', '=', relation)
        .execute(),
    );
    return rows.map(toEntity);
  }

  /**
   * enum の field ごとに件数と合計を出す。正本 §15.3 の pipeline analysis。
   *
   * **集計そのものは汎用**にしてある。CRM 専用の SQL を書くと、
   * 次の専業 Agent でまた同じものを書くことになる。
   */
  async groupBy(
    tenantId: string,
    pluginId: string,
    entityType: string,
    groupField: string,
    sumField?: string,
  ): Promise<{ group: string; count: number; total: number }[]> {
    const rows = await this.list(tenantId, pluginId, entityType, 1_000);
    const buckets = new Map<string, { count: number; total: number }>();

    for (const row of rows) {
      const key = String(row.fields[groupField] ?? '未設定');
      const bucket = buckets.get(key) ?? { count: 0, total: 0 };
      bucket.count += 1;
      if (sumField) {
        const value = row.fields[sumField];
        if (typeof value === 'number') bucket.total += value;
      }
      buckets.set(key, bucket);
    }

    return (
      [...buckets.entries()]
        .map(([group, b]) => ({ group, ...b }))
        // 同数のときの並びを決めておく。実行ごとに順番が変わらないように。
        .sort((a, b) => b.total - a.total || b.count - a.count || a.group.localeCompare(b.group))
    );
  }
}

function toEntity(row: Record<string, unknown>): DomainEntity {
  const iso = (v: unknown): string => (v instanceof Date ? v.toISOString() : String(v));
  return {
    id: row['id'] as string,
    plugin_id: row['plugin_id'] as string,
    entity_type: row['entity_type'] as string,
    title: row['title'] as string,
    fields: (row['fields'] ?? {}) as Record<string, unknown>,
    source_task_id: (row['source_task_id'] ?? null) as string | null,
    source_meeting_id: (row['source_meeting_id'] ?? null) as string | null,
    created_at: iso(row['created_at']),
    updated_at: iso(row['updated_at']),
  };
}
