/**
 * Library。正本 §2.3、実装仕様 §8。
 *
 * Phase 0 の範囲: artifact の作成 / 一覧 / 取得 / 本体取得。
 * 共有リンク（Phase 2）、セマンティック検索（Phase 2）、バージョン追加 API（Phase 1）は含まない。
 */
import type { Readable } from 'node:stream';
import {
  Artifact,
  AstraError,
  MAX_DIRECT_UPLOAD_BYTES,
  objectKeyFor,
  uuidv7,
  type ArtifactType,
  type Sensitivity,
} from '@astra/contracts';
import { withTenant, type DbHandle, type ScopedDb } from '@astra/db';
import { appendAuditEvent } from '@astra/telemetry';
import type { ObjectStore } from './store/index.js';

export interface CreateArtifactInput {
  readonly tenantId: string;
  readonly ownerId: string;
  readonly type: ArtifactType;
  readonly title: string;
  readonly mimeType: string;
  readonly body: Buffer;
  readonly fileName?: string;
  readonly sourceTaskId?: string | null;
  readonly sourceMeetingId?: string | null;
  readonly sourceAgentId?: string | null;
  readonly parentArtifactId?: string | null;
  readonly tags?: readonly string[];
  readonly sensitivity?: Sensitivity;
}

export interface ListArtifactsQuery {
  readonly tenantId: string;
  readonly limit: number;
  readonly cursor?: string | undefined;
  readonly type?: ArtifactType | undefined;
  /** ある仕事から生まれたものだけ。§9.2 Outputs / §10.2 lineage。 */
  readonly sourceTaskId?: string | undefined;
}

export class LibraryService {
  readonly #db: DbHandle;
  readonly #store: ObjectStore;

  constructor(db: DbHandle, store: ObjectStore) {
    this.#db = db;
    this.#store = store;
  }

  /**
   * artifact を作る。オブジェクト保存 → メタデータ挿入の順。
   *
   * 逆順にすると、保存に失敗したときに実体の無い artifact 行が残る。
   * この順なら、失敗して残るのは参照されない object だけで、後から掃除できる。
   */
  async create(input: CreateArtifactInput): Promise<Artifact> {
    if (input.body.byteLength > MAX_DIRECT_UPLOAD_BYTES) {
      throw new AstraError(
        'artifact.too_large',
        `direct upload is limited to ${MAX_DIRECT_UPLOAD_BYTES} bytes`,
      );
    }

    const artifactId = uuidv7();
    const key = objectKeyFor(input.tenantId, artifactId, 1, input.fileName ?? input.title);
    const stored = await this.#store.put(key, input.body, { contentType: input.mimeType });

    return withTenant(this.#db, input.tenantId, async (tx) => {
      const now = new Date();
      await tx
        .insertInto('artifacts')
        .values({
          id: artifactId,
          tenant_id: input.tenantId,
          owner_id: input.ownerId,
          type: input.type,
          title: input.title,
          mime_type: input.mimeType,
          source_agent_id: input.sourceAgentId ?? null,
          source_task_id: input.sourceTaskId ?? null,
          source_meeting_id: input.sourceMeetingId ?? null,
          parent_artifact_id: input.parentArtifactId ?? null,
          current_version: 1,
          tags: [...(input.tags ?? [])],
          sensitivity: input.sensitivity ?? 'PRIVATE',
          created_at: now,
          updated_at: now,
        })
        .execute();

      await tx
        .insertInto('artifact_versions')
        .values({
          artifact_id: artifactId,
          version: 1,
          tenant_id: input.tenantId,
          object_key: key,
          size: String(stored.size),
          sha256: stored.sha256,
          created_by: input.ownerId,
          created_at: now,
        })
        .execute();

      await appendAuditEvent(tx, input.tenantId, {
        actorType: input.sourceTaskId ? 'agent' : 'user',
        actorId: input.ownerId,
        action: 'artifact.created',
        taskId: input.sourceTaskId ?? null,
        payload: { artifact_id: artifactId, type: input.type, size: stored.size },
      });

      return this.#load(tx, artifactId);
    });
  }

  async get(tenantId: string, artifactId: string): Promise<Artifact> {
    return withTenant(this.#db, tenantId, (tx) => this.#load(tx, artifactId));
  }

  /**
   * あるタスクが作った成果物を探す。無ければ null。
   *
   * activity の再実行で成果物を二重に作らないために task 側が使う。
   * `artifacts` は library の所有テーブルなので、他サービスから直接引かせない（§5.1）。
   */
  async findBySourceTask(tenantId: string, taskId: string): Promise<Artifact | null> {
    return withTenant(this.#db, tenantId, async (tx) => {
      const row = await tx
        .selectFrom('artifacts')
        .select(['id'])
        .where('source_task_id', '=', taskId)
        .where('deleted_at', 'is', null)
        .orderBy('id', 'asc')
        .executeTakeFirst();
      return row ? this.#load(tx, row.id) : null;
    });
  }

  async list(query: ListArtifactsQuery): Promise<{ items: Artifact[]; nextCursor: string | null }> {
    return withTenant(this.#db, query.tenantId, async (tx) => {
      let statement = tx
        .selectFrom('artifacts')
        .selectAll()
        .where('deleted_at', 'is', null)
        .orderBy('updated_at', 'desc')
        .orderBy('id', 'desc')
        .limit(query.limit + 1);

      if (query.type) statement = statement.where('type', '=', query.type);
      if (query.sourceTaskId) {
        statement = statement.where('source_task_id', '=', query.sourceTaskId);
      }
      // UUIDv7 の時系列性を使うので、カーソルは id そのもの
      if (query.cursor) statement = statement.where('id', '<', query.cursor);

      const rows = await statement.execute();
      const page = rows.slice(0, query.limit);
      const versions = await this.#versionsFor(
        tx,
        page.map((r) => r.id),
      );

      return {
        items: page.map((row) => toArtifact(row, versions.get(row.id))),
        nextCursor: rows.length > query.limit ? (page.at(-1)?.id ?? null) : null,
      };
    });
  }

  /** 本体を返す。越境は 404（逸脱 D-11）。 */
  async readContent(
    tenantId: string,
    artifactId: string,
  ): Promise<{ stream: Readable; artifact: Artifact }> {
    const artifact = await this.get(tenantId, artifactId);
    return { stream: await this.#store.get(artifact.object_key), artifact };
  }

  async #load(tx: ScopedDb, artifactId: string): Promise<Artifact> {
    const row = await tx
      .selectFrom('artifacts')
      .selectAll()
      .where('id', '=', artifactId)
      .where('deleted_at', 'is', null)
      .executeTakeFirst();
    // RLS で他テナントの行は見えないので、ここに来る「無い」は 404 で正しい
    if (!row) throw new AstraError('artifact.not_found', `no artifact ${artifactId}`);

    const versions = await this.#versionsFor(tx, [artifactId]);
    return toArtifact(row, versions.get(artifactId));
  }

  async #versionsFor(
    tx: ScopedDb,
    artifactIds: readonly string[],
  ): Promise<Map<string, { object_key: string; size: string; sha256: string; version: number }>> {
    if (artifactIds.length === 0) return new Map();
    const rows = await tx
      .selectFrom('artifact_versions')
      .select(['artifact_id', 'version', 'object_key', 'size', 'sha256'])
      .where('artifact_id', 'in', [...artifactIds])
      .execute();

    const latest = new Map<
      string,
      { object_key: string; size: string; sha256: string; version: number }
    >();
    for (const row of rows) {
      const current = latest.get(row.artifact_id);
      if (!current || row.version > current.version) {
        latest.set(row.artifact_id, {
          object_key: row.object_key,
          size: row.size,
          sha256: row.sha256,
          version: row.version,
        });
      }
    }
    return latest;
  }
}

type ArtifactRow = {
  id: string;
  tenant_id: string;
  owner_id: string;
  type: string;
  title: string;
  mime_type: string;
  source_agent_id: string | null;
  source_task_id: string | null;
  source_meeting_id: string | null;
  parent_artifact_id: string | null;
  current_version: number;
  tags: string[];
  sensitivity: string;
  searchable_text_ref: string | null;
  created_at: Date;
  updated_at: Date;
};

function toArtifact(
  row: ArtifactRow,
  version: { object_key: string; size: string; sha256: string; version: number } | undefined,
): Artifact {
  if (!version) {
    // 版が無い artifact は作れない。あるなら書き込み経路が壊れている。
    throw new AstraError('common.internal', `artifact ${row.id} has no version row`);
  }
  return Artifact.parse({
    id: row.id,
    tenant_id: row.tenant_id,
    owner_id: row.owner_id,
    type: row.type,
    title: row.title,
    mime_type: row.mime_type,
    source_agent_id: row.source_agent_id,
    source_task_id: row.source_task_id,
    source_meeting_id: row.source_meeting_id,
    parent_artifact_id: row.parent_artifact_id,
    version: version.version,
    object_key: version.object_key,
    size: Number(version.size),
    sha256: version.sha256,
    tags: row.tags,
    entities: [],
    lineage: [],
    sensitivity: row.sensitivity,
    searchable_text_ref: row.searchable_text_ref,
    created_at: row.created_at.toISOString(),
    updated_at: row.updated_at.toISOString(),
  });
}
