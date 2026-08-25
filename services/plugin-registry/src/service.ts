/**
 * Plugin registry。実装仕様 §9。
 *
 * Phase 0 の範囲: manifest の検証・同梱プラグインの seed・カタログ参照・install 記録。
 * **実行はしない**（Phase 4）。
 */
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import {
  AstraError,
  CORE_VERSION,
  PluginCatalogEntry,
  isCompatible,
  uuidv7,
  type InstallPluginRequest,
  type PermissionScope,
  type PluginInstall,
  type PluginManifest,
} from '@astra/contracts';
import { withSystem, withTenant, type DbHandle, type ScopedDb } from '@astra/db';
import { appendAuditEvent } from '@astra/telemetry';
import {
  loadManifestFile,
  signatureStateFor,
  verifyManifestSignature,
  type LoadedManifest,
} from '@astra/plugin-sdk';

export interface RegistryDeps {
  readonly db: DbHandle;
  /** アプリ本体の版。manifest の `min_core_version` と突き合わせる。 */
  readonly coreVersion?: string;
}

export class PluginRegistryService {
  readonly #db: DbHandle;
  readonly #coreVersion: string;

  constructor(deps: RegistryDeps) {
    this.#db = deps.db;
    this.#coreVersion = deps.coreVersion ?? CORE_VERSION;
  }

  /**
   * 同梱プラグインを読み込んで登録する。起動時に 1 回。
   *
   * カタログはテナント横断なので system スコープ（§5.4）。
   * 同じ内容の再実行で状態が変わらないよう、manifest のハッシュで冪等にする。
   */
  async seedBuiltins(builtinDir: string): Promise<PluginManifest[]> {
    const entries = await readdir(builtinDir, { withFileTypes: true });
    const loaded: LoadedManifest[] = [];

    for (const entry of entries.filter((e) => e.isDirectory())) {
      loaded.push(await loadManifestFile(path.join(builtinDir, entry.name, 'plugin.yaml')));
    }

    await withSystem(this.#db, async (tx) => {
      for (const item of loaded) {
        await this.#upsert(tx, item, 'BUILTIN_TRUSTED');
      }
    });

    return loaded.map((l) => l.manifest);
  }

  /** 外部プラグインの登録。署名が検証できないものは受け付けない（§9.2）。 */
  async publish(loaded: LoadedManifest): Promise<void> {
    const { manifest } = loaded;
    await withSystem(this.#db, async (tx) => {
      const publisher = await tx
        .selectFrom('plugin_publishers')
        .select(['public_key'])
        .where('id', '=', manifest.publisher)
        .executeTakeFirst();
      if (!publisher) {
        throw new AstraError('plugin.unsigned', `unknown publisher ${manifest.publisher}`);
      }

      const verified = verifyManifestSignature(
        loaded.canonical,
        manifest.signature,
        publisher.public_key,
      );
      const state = signatureStateFor(manifest, verified);
      if (state === 'UNSIGNED') {
        throw new AstraError('plugin.unsigned', `manifest for ${manifest.id} is not signed`);
      }
      await this.#upsert(tx, loaded, state);
    });
  }

  async catalog(tenantId: string): Promise<PluginCatalogEntry[]> {
    const installs = await withTenant(this.#db, tenantId, (tx) =>
      tx
        .selectFrom('plugin_installs')
        .select(['plugin_id', 'version'])
        .where('state', '=', 'INSTALLED')
        .execute(),
    );
    const installed = new Map(installs.map((i) => [i.plugin_id, i.version]));

    const rows = await withSystem(this.#db, (tx) =>
      tx
        .selectFrom('plugins')
        .innerJoin('plugin_versions', (join) =>
          join
            .onRef('plugin_versions.plugin_id', '=', 'plugins.id')
            .onRef('plugin_versions.version', '=', 'plugins.latest_version'),
        )
        .select([
          'plugins.id as id',
          'plugins.name as name',
          'plugins.publisher_id as publisher',
          'plugins.category as category',
          'plugins.builtin as builtin',
          'plugins.removable as removable',
          'plugins.latest_version as latest_version',
          'plugin_versions.compliance_profile as compliance_profile',
          'plugin_versions.manifest as manifest',
          'plugin_versions.signature_state as signature_state',
        ])
        .where('plugin_versions.yanked_at', 'is', null)
        .orderBy('plugins.id')
        .execute(),
    );

    return rows.map((row) => {
      const manifest = row.manifest as unknown as PluginManifest;
      return PluginCatalogEntry.parse({
        id: row.id,
        name: row.name,
        publisher: row.publisher,
        verified: manifest.verified,
        category: row.category,
        latest_version: row.latest_version,
        compliance_profile: row.compliance_profile,
        builtin: row.builtin,
        removable: row.removable,
        permissions: manifest.permissions,
        // 正本 §2.4: detail page が「data accessed」を必ず出せるようにする
        data_accessed: manifest.data_accessed,
        tool_count: manifest.tools.length,
        execution_surfaces: manifest.execution_surfaces,
        signature_state: row.signature_state,
        installed: installed.has(row.id),
        installed_version: installed.get(row.id) ?? null,
      });
    });
  }

  async get(tenantId: string, pluginId: string): Promise<PluginCatalogEntry> {
    const entry = (await this.catalog(tenantId)).find((p) => p.id === pluginId);
    if (!entry) throw new AstraError('plugin.not_found', `no plugin ${pluginId}`);
    return entry;
  }

  /**
   * install を記録する。
   *
   * 正本 §3 Step 5「一度に全 permission を要求しない」に従い、要求スコープのうち
   * 未許可のものがあっても install は成立させ、そのスコープを `granted=false` で残す。
   * 後から利用直前に purpose-first で追加許可を取る前提。
   */
  async install(
    tenantId: string,
    userId: string,
    pluginId: string,
    request: InstallPluginRequest,
  ): Promise<PluginInstall> {
    const version = await withSystem(this.#db, async (tx) => {
      const row = await tx
        .selectFrom('plugin_versions')
        .select(['plugin_id', 'version', 'min_core_version', 'manifest', 'yanked_at'])
        .where('plugin_id', '=', pluginId)
        .where('version', '=', request.version)
        .executeTakeFirst();
      if (!row || row.yanked_at !== null) {
        throw new AstraError('plugin.not_found', `no plugin ${pluginId}@${request.version}`);
      }
      if (!isCompatible(row.min_core_version, this.#coreVersion)) {
        throw new AstraError(
          'plugin.incompatible',
          `${pluginId}@${request.version} requires core >= ${row.min_core_version}`,
        );
      }
      return row;
    });

    const manifest = version.manifest as unknown as PluginManifest;
    const requested = new Set<PermissionScope>(manifest.permissions);
    const granted = request.granted_scopes.filter((s) => requested.has(s));
    const denied = [...requested].filter((s) => !granted.includes(s));

    return withTenant(this.#db, tenantId, async (tx) => {
      const existing = await tx
        .selectFrom('plugin_installs')
        .select(['id'])
        .where('plugin_id', '=', pluginId)
        .where('state', '!=', 'UNINSTALLED')
        .executeTakeFirst();

      const installId = existing?.id ?? uuidv7();
      const now = new Date();

      if (existing) {
        await tx
          .updateTable('plugin_installs')
          .set({ version: request.version, state: 'INSTALLED', updated_at: now })
          .where('id', '=', installId)
          .execute();
        await tx.deleteFrom('plugin_permissions').where('install_id', '=', installId).execute();
      } else {
        await tx
          .insertInto('plugin_installs')
          .values({
            id: installId,
            tenant_id: tenantId,
            plugin_id: pluginId,
            version: request.version,
            installed_by: userId,
            state: 'INSTALLED',
            installed_at: now,
            updated_at: now,
          })
          .execute();
      }

      const scopes = [
        ...granted.map((scope) => ({ scope, granted: true })),
        ...denied.map((scope) => ({ scope, granted: false })),
      ];
      if (scopes.length > 0) {
        await tx
          .insertInto('plugin_permissions')
          .values(
            scopes.map((s) => ({
              install_id: installId,
              tenant_id: tenantId,
              scope: s.scope,
              granted: s.granted,
              granted_by: s.granted ? userId : null,
              granted_at: now,
            })),
          )
          .execute();
      }

      await appendAuditEvent(tx, tenantId, {
        actorType: 'user',
        actorId: userId,
        action: 'plugin.install',
        payload: { plugin_id: pluginId, version: request.version, granted, denied },
      });
      if (granted.length > 0) {
        await appendAuditEvent(tx, tenantId, {
          actorType: 'user',
          actorId: userId,
          action: 'plugin.permission.grant',
          payload: { plugin_id: pluginId, scopes: granted },
        });
      }

      return {
        id: installId,
        tenant_id: tenantId,
        plugin_id: pluginId,
        version: request.version,
        installed_by: userId,
        state: 'INSTALLED',
        granted_scopes: granted,
        denied_scopes: denied,
        installed_at: now.toISOString(),
        updated_at: now.toISOString(),
      } as PluginInstall;
    });
  }

  /** 同梱かつ removable=false のものは外せない（実装仕様 §9.3）。 */
  async uninstall(tenantId: string, userId: string, pluginId: string): Promise<void> {
    const plugin = await withSystem(this.#db, (tx) =>
      tx
        .selectFrom('plugins')
        .select(['id', 'builtin', 'removable'])
        .where('id', '=', pluginId)
        .executeTakeFirst(),
    );
    if (!plugin) throw new AstraError('plugin.not_found', `no plugin ${pluginId}`);
    if (plugin.builtin && !plugin.removable) {
      throw new AstraError('plugin.not_removable', `${pluginId} is a built-in capability`);
    }

    await withTenant(this.#db, tenantId, async (tx) => {
      const result = await tx
        .updateTable('plugin_installs')
        .set({ state: 'UNINSTALLED', updated_at: new Date() })
        .where('plugin_id', '=', pluginId)
        .where('state', '!=', 'UNINSTALLED')
        .executeTakeFirst();
      if (Number(result.numUpdatedRows) === 0) {
        throw new AstraError('plugin.not_found', `${pluginId} is not installed`);
      }
      await appendAuditEvent(tx, tenantId, {
        actorType: 'user',
        actorId: userId,
        action: 'plugin.uninstall',
        payload: { plugin_id: pluginId },
      });
    });
  }

  async #upsert(tx: ScopedDb, loaded: LoadedManifest, state: string): Promise<void> {
    const { manifest } = loaded;

    await tx
      .insertInto('plugin_publishers')
      .values({
        id: manifest.publisher,
        display_name: manifest.publisher,
        // 同梱プラグインは署名を要さないので鍵を持たない。外部公開時に publish() が要求する。
        public_key: '',
        verified: manifest.verified,
      })
      .onConflict((oc) => oc.column('id').doNothing())
      .execute();

    await tx
      .insertInto('plugins')
      .values({
        id: manifest.id,
        publisher_id: manifest.publisher,
        name: manifest.name,
        category: manifest.category,
        builtin: manifest.builtin,
        removable: manifest.removable,
        latest_version: manifest.version,
        updated_at: new Date(),
      })
      .onConflict((oc) =>
        oc.column('id').doUpdateSet({
          name: manifest.name,
          latest_version: manifest.version,
          removable: manifest.removable,
          updated_at: new Date(),
        }),
      )
      .execute();

    await tx
      .insertInto('plugin_versions')
      .values({
        plugin_id: manifest.id,
        version: manifest.version,
        min_core_version: manifest.min_core_version,
        compliance_profile: manifest.compliance_profile,
        manifest: JSON.stringify(manifest),
        manifest_sha256: loaded.sha256,
        signature: manifest.signature ?? null,
        signature_state: state,
      })
      .onConflict((oc) =>
        oc.columns(['plugin_id', 'version']).doUpdateSet({
          manifest: JSON.stringify(manifest),
          manifest_sha256: loaded.sha256,
          signature_state: state,
        }),
      )
      .execute();
  }
}
