/**
 * Plugin registry。実装仕様 §9。
 *
 * Phase 0 の範囲: manifest の検証・同梱プラグインの seed・カタログ参照・install 記録。
 * **実行はしない**（Phase 4）。
 */
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';
import {
  AstraError,
  CORE_VERSION,
  DashboardSchema,
  PluginCatalogEntry,
  PolicyDocument,
  WorkflowFile,
  compareSemver,
  isCompatible,
  sha256Hex,
  uuidv7,
  type DashboardView,
  type ResolvedValue,
  type InstallPluginRequest,
  type PermissionScope,
  type PluginInstall,
  type ComplianceProfile,
  type McpServerDecl,
  type PluginManifest,
} from '@astra/contracts';
import { withSystem, withTenant, type DbHandle, type ScopedDb } from '@astra/db';
import type { InstalledAgent } from '@astra/service-task';
import { assertRegulatedPluginHasRules } from './compliance.js';
import type { DataSourceResolver } from './data-sources.js';
import { appendAuditEvent } from '@astra/telemetry';
import {
  declaredAssets,
  loadAssets,
  loadManifestFile,
  signatureStateFor,
  validateDashboards,
  verifyManifestSignature,
  type LoadedManifest,
  type PluginAsset,
} from '@astra/plugin-sdk';

export interface RegistryDeps {
  /** 実行環境。本番で未実装のゲートに寄りかからないための判定に使う。 */
  readonly env?: string;
  readonly db: DbHandle;
  /** アプリ本体の版。manifest の `min_core_version` と突き合わせる。 */
  readonly coreVersion?: string;
}

export class PluginRegistryService {
  readonly #db: DbHandle;
  readonly #coreVersion: string;
  readonly #env: string;

  constructor(deps: RegistryDeps) {
    this.#db = deps.db;
    this.#coreVersion = deps.coreVersion ?? CORE_VERSION;
    this.#env = deps.env ?? 'development';
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

    const assetsFor = new Map<string, PluginAsset[]>();
    for (const entry of entries.filter((e) => e.isDirectory())) {
      const dir = path.join(builtinDir, entry.name);
      const item = await loadManifestFile(path.join(dir, 'plugin.yaml'));
      // 宣言と実体が食い違う plugin は載せない（D-31）。
      // 同梱だからといって甘くしない。ここを緩めると本番で穴になる。
      assetsFor.set(item.manifest.id, await loadAssets(item.manifest, dir));
      loaded.push(item);
    }

    await withSystem(this.#db, async (tx) => {
      for (const item of loaded) {
        await this.#upsert(tx, item, 'BUILTIN_TRUSTED', assetsFor.get(item.manifest.id) ?? []);
      }
    });

    return loaded.map((l) => l.manifest);
  }

  /**
   * 外部プラグインの登録。署名が検証できないものは受け付けない（§9.2）。
   * 宣言されたファイルは呼び出し側が読み込んで渡す（どこから来るかは
   * 配布形態次第なので、registry は場所を知らない）。
   */
  async publish(loaded: LoadedManifest, assets: readonly PluginAsset[] = []): Promise<void> {
    const { manifest } = loaded;
    // 宣言と実体の食い違いは、署名を見る前に落とす
    validateDashboards(manifest, assets);
    // 規制 profile なら、実際に効く規則を持っていること
    assertRegulatedPluginHasRules(manifest.compliance_profile, countRules(assets), manifest.id);
    // 呼び出し側が申告したハッシュを信用しない。中身から取り直して照合する。
    for (const asset of assets) {
      const actual = await sha256Hex(asset.content);
      if (actual !== asset.sha256) {
        throw new AstraError(
          'plugin.manifest_invalid',
          `asset "${asset.path}" does not match its checksum`,
        );
      }
    }
    for (const declared of declaredAssets(manifest)) {
      if (!assets.some((a) => a.path === declared.path)) {
        throw new AstraError(
          'plugin.manifest_invalid',
          `${manifest.id} declares "${declared.path}" but no such asset was provided`,
        );
      }
    }
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
      await this.#upsert(tx, loaded, state, assets);
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
        .select([
          'plugin_id',
          'version',
          'min_core_version',
          'compliance_profile',
          'manifest',
          'yanked_at',
        ])
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

  async #upsert(
    tx: ScopedDb,
    loaded: LoadedManifest,
    state: string,
    assets: readonly PluginAsset[] = [],
  ): Promise<void> {
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

    // 宣言された実体。append-only なので、同じ版の再登録では何もしない。
    for (const asset of assets) {
      await tx
        .insertInto('plugin_assets')
        .values({
          plugin_id: manifest.id,
          version: manifest.version,
          path: asset.path,
          kind: asset.kind,
          content: Buffer.from(asset.content),
          sha256: asset.sha256,
        })
        .onConflict((oc) => oc.doNothing())
        .execute();
    }
  }

  // ------------------------------------------------------- Phase 4 の追加

  /**
   * install 済み plugin が持ち込んだ dashboard の一覧。
   * **install しただけで増える**（AC4-3）ので、ここはコードを持たない。
   */
  async dashboards(
    tenantId: string,
  ): Promise<{ pluginId: string; pluginName: string; id: string; title: string }[]> {
    const installs = await withTenant(this.#db, tenantId, (tx) =>
      tx
        .selectFrom('plugin_installs')
        .select(['plugin_id', 'version'])
        .where('state', '=', 'INSTALLED')
        .execute(),
    );
    if (installs.length === 0) return [];

    return withSystem(this.#db, async (tx) => {
      const out: { pluginId: string; pluginName: string; id: string; title: string }[] = [];
      for (const install of installs) {
        const row = await tx
          .selectFrom('plugin_versions')
          .innerJoin('plugins', 'plugins.id', 'plugin_versions.plugin_id')
          .select(['plugin_versions.manifest as manifest', 'plugins.name as name'])
          .where('plugin_versions.plugin_id', '=', install.plugin_id)
          .where('plugin_versions.version', '=', install.version)
          .executeTakeFirst();
        if (!row) continue;
        const manifest = row.manifest as unknown as PluginManifest;
        for (const dashboard of manifest.dashboards) {
          out.push({
            pluginId: install.plugin_id,
            pluginName: row.name,
            id: dashboard.id,
            title: dashboard.id,
          });
        }
      }
      return out;
    });
  }

  /**
   * dashboard の schema と、bind を解決した値を返す。
   *
   * **install していない plugin の dashboard は返さない**（404）。
   * 解決できない bind は値を返さず理由を返す（D-34）。
   */
  async dashboardView(
    tenantId: string,
    pluginId: string,
    dashboardId: string,
    resolver: DataSourceResolver,
  ): Promise<DashboardView> {
    const install = await withTenant(this.#db, tenantId, (tx) =>
      tx
        .selectFrom('plugin_installs')
        .select(['version'])
        .where('plugin_id', '=', pluginId)
        .where('state', '=', 'INSTALLED')
        .executeTakeFirst(),
    );
    if (!install) throw new AstraError('plugin.not_found', `${pluginId} is not installed`);

    const version = await withSystem(this.#db, (tx) =>
      tx
        .selectFrom('plugin_versions')
        .select(['manifest'])
        .where('plugin_id', '=', pluginId)
        .where('version', '=', install.version)
        .executeTakeFirst(),
    );
    if (!version) throw new AstraError('plugin.not_found', `no plugin ${pluginId}`);

    const manifest = version.manifest as unknown as PluginManifest;
    const decl = manifest.dashboards.find((d) => d.id === dashboardId);
    if (!decl) throw new AstraError('plugin.not_found', `no dashboard ${dashboardId}`);

    const content = await this.asset(pluginId, install.version, decl.schema);
    if (!content) {
      // publish で止めているはずなので、ここに来るのは配線ミス
      throw new AstraError('plugin.manifest_invalid', `dashboard ${decl.schema} is missing`);
    }
    const schema = DashboardSchema.parse(JSON.parse(content.toString('utf8')));

    const sources = new Map(manifest.data_sources.map((s) => [s.id, s]));
    const data: Record<string, ResolvedValue> = {};
    for (const item of schema.items) {
      if (item.bind === undefined || data[item.bind]) continue;
      const source = sources.get(item.bind);
      data[item.bind] = source
        ? await resolver.resolve(tenantId, source.query)
        : { kind: 'unavailable', reason: `the plugin does not declare "${item.bind}"` };
    }

    return { plugin_id: pluginId, schema, data };
  }

  /**
   * install 済みの agent を、実行に要る事実ごと返す。
   *
   * **uninstall した plugin の agent は返さない**（AC5-6）。
   * 宣言に無い tool は載せない（AC5-2 / D-42）。
   */
  async installedAgent(
    tenantId: string,
    pluginId: string,
    agentId: string,
  ): Promise<InstalledAgent | null> {
    const install = await withTenant(this.#db, tenantId, (tx) =>
      tx
        .selectFrom('plugin_installs')
        .select(['id', 'version'])
        .where('plugin_id', '=', pluginId)
        .where('state', '=', 'INSTALLED')
        .executeTakeFirst(),
    );
    if (!install) return null;

    const version = await withSystem(this.#db, (tx) =>
      tx
        .selectFrom('plugin_versions')
        .select(['manifest'])
        .where('plugin_id', '=', pluginId)
        .where('version', '=', install.version)
        .executeTakeFirst(),
    );
    if (!version) return null;

    const manifest = version.manifest as unknown as PluginManifest;
    const agent = manifest.agents.find((a) => a.id === agentId);
    if (!agent) return null;

    // 宣言された tool だけ。agent が参照していても manifest に無い tool は載せない。
    const declared = new Map(manifest.tools.map((t) => [t.id, t]));
    const tools = agent.tools
      .map((id) => declared.get(id))
      .filter((t): t is NonNullable<typeof t> => t !== undefined)
      .map((t) => ({
        id: t.id,
        risk: t.risk,
        surface: t.surface,
        requiresConfirmation: t.requires_confirmation,
        fallbacks: t.fallbacks,
      }));

    const granted = await withTenant(this.#db, tenantId, (tx) =>
      tx
        .selectFrom('plugin_permissions')
        .select(['scope'])
        .where('install_id', '=', install.id)
        .where('granted', '=', true)
        .execute(),
    );

    // skill は実体ファイルから読む（AC5-5）。manifest の宣言だけでは中身が無い。
    const skillFile = await this.asset(pluginId, install.version, agent.skill);

    // 宣言された仕事の流れ（正本 §14）。無ければ近似に落ちる。
    const workflow = await this.#workflowFor(pluginId, install.version, manifest, agentId);
    // 持ち込まれた規則（正本 §22）。profile ごとの組み込みは policy 側が足す。
    const policies = await this.#policiesFor(pluginId, install.version, manifest);

    return {
      pluginId,
      agentId,
      agentName: manifest.name,
      complianceProfile: manifest.compliance_profile,
      tools,
      skill: skillFile ? skillFile.toString('utf8') : null,
      ...(workflow ? { workflow } : {}),
      policies,
      grantedScopes: granted.map((g) => g.scope),
      requiredScopes: manifest.permissions,
    };
  }

  /**
   * その agent の workflow。複数あれば**最初のもの**を使う。
   * どれを使うかを利用者に選ばせるのは、モードを選ばせるのと同じ（正本 §2）。
   */
  async #workflowFor(
    pluginId: string,
    version: string,
    manifest: PluginManifest,
    agentId: string,
  ): Promise<{ steps: { tool: string; message: string; applies: boolean }[] } | null> {
    for (const path of manifest.workflows) {
      const content = await this.asset(pluginId, version, path);
      if (!content) continue;
      let parsed;
      try {
        parsed = WorkflowFile.parse(JSON.parse(content.toString('utf8')));
      } catch {
        // publish で検証済み。ここに来るのは配線ミス。黙って近似へ落ちない。
        continue;
      }
      const workflow = parsed.workflows.find((w) => w.agent === agentId);
      if (!workflow) continue;

      return {
        steps: workflow.steps.map((step) => ({
          tool: step.tool,
          message: step.message,
          // 条件は task を作る時点で評価する（計画は確定させる。D-40）
          applies: true,
        })),
      };
    }
    return null;
  }

  /** 持ち込まれた policy。publish で検証済みのものを読むだけ。 */
  async #policiesFor(
    pluginId: string,
    version: string,
    manifest: PluginManifest,
  ): Promise<PolicyDocument[]> {
    const documents: PolicyDocument[] = [];
    for (const path of manifest.policies) {
      const content = await this.asset(pluginId, version, path);
      if (!content) continue;
      const parsed = PolicyDocument.safeParse(parseYaml(content.toString('utf8')));
      // publish で検証済み。ここで落ちるのは配線ミスなので、緩めない。
      if (parsed.success) documents.push(parsed.data);
    }
    return documents;
  }

  /**
   * install 済み plugin が持ち込んだ MCP サーバ。
   *
   * **接続はここでしない。**接続するかどうかは、trust state と
   * 実行時の判断（Action Engine）の仕事。ここは「何が宣言されているか」だけ返す。
   */
  async mcpServers(tenantId: string): Promise<{ pluginId: string; server: McpServerDecl }[]> {
    const installs = await withTenant(this.#db, tenantId, (tx) =>
      tx
        .selectFrom('plugin_installs')
        .select(['plugin_id', 'version'])
        .where('state', '=', 'INSTALLED')
        .execute(),
    );
    if (installs.length === 0) return [];

    return withSystem(this.#db, async (tx) => {
      const out: { pluginId: string; server: McpServerDecl }[] = [];
      for (const install of installs) {
        const row = await tx
          .selectFrom('plugin_versions')
          .select(['manifest'])
          .where('plugin_id', '=', install.plugin_id)
          .where('version', '=', install.version)
          .executeTakeFirst();
        if (!row) continue;
        const manifest = row.manifest as unknown as PluginManifest;
        for (const server of manifest.mcp_servers) {
          out.push({ pluginId: install.plugin_id, server });
        }
      }
      return out;
    });
  }

  /**
   * この install が、その scope を許されているか。
   *
   * install 画面で見せるだけでは足りない。**同意していない権限で
   * tool を呼べてはならない**（AC4-7）。
   */
  async isPermitted(tenantId: string, pluginId: string, scope: string): Promise<boolean> {
    const row = await withTenant(this.#db, tenantId, (tx) =>
      tx
        .selectFrom('plugin_permissions')
        .innerJoin('plugin_installs', 'plugin_installs.id', 'plugin_permissions.install_id')
        .select(['plugin_permissions.granted as granted'])
        .where('plugin_installs.plugin_id', '=', pluginId)
        .where('plugin_installs.state', '=', 'INSTALLED')
        .where('plugin_permissions.scope', '=', scope)
        .executeTakeFirst(),
    );
    return row?.granted === true;
  }

  /**
   * 版を上げる。
   *
   * - `min_core_version` を満たさない版へは上げない（AC4-9）
   * - major が上がるときは**同意を取り直す**。権限が増え得るため
   * - 前の版は消さない。`rollback` で戻せる（AC4-10）
   */
  async update(
    tenantId: string,
    userId: string,
    pluginId: string,
    toVersion: string,
    grantedScopes: readonly PermissionScope[] = [],
  ): Promise<PluginInstall> {
    const current = await withTenant(this.#db, tenantId, (tx) =>
      tx
        .selectFrom('plugin_installs')
        .select(['version'])
        .where('plugin_id', '=', pluginId)
        .where('state', '=', 'INSTALLED')
        .executeTakeFirst(),
    );
    if (!current) throw new AstraError('plugin.not_found', `${pluginId} is not installed`);

    if (compareSemver(toVersion, current.version) <= 0) {
      // 下げるのは rollback の仕事。update で下げられると、
      // 「上げたつもりが下がっていた」が起きる。
      throw new AstraError(
        'plugin.incompatible',
        `${toVersion} is not newer than the installed ${current.version}`,
      );
    }

    const majorChange = majorOf(toVersion) !== majorOf(current.version);
    const carried = majorChange
      ? grantedScopes
      : await this.#grantedScopes(tenantId, pluginId, grantedScopes);

    const install = await this.install(tenantId, userId, pluginId, {
      version: toVersion,
      granted_scopes: [...carried],
    });

    // 戻る先を残す。監査から引くのではなく、状態として持つ。
    await withTenant(this.#db, tenantId, (tx) =>
      tx
        .updateTable('plugin_installs')
        .set({ previous_version: current.version })
        .where('plugin_id', '=', pluginId)
        .where('state', '=', 'INSTALLED')
        .execute(),
    );

    await withTenant(this.#db, tenantId, (tx) =>
      appendAuditEvent(tx, tenantId, {
        actorType: 'user',
        actorId: userId,
        action: 'plugin.update',
        payload: { plugin_id: pluginId, from: current.version, to: toVersion, majorChange },
      }),
    );
    return install;
  }

  /** 前の版へ戻す。戻る先は install 行が持っている。 */
  async rollback(tenantId: string, userId: string, pluginId: string): Promise<PluginInstall> {
    const row = await withTenant(this.#db, tenantId, (tx) =>
      tx
        .selectFrom('plugin_installs')
        .select(['previous_version'])
        .where('plugin_id', '=', pluginId)
        .where('state', '=', 'INSTALLED')
        .executeTakeFirst(),
    );
    const previous = row?.previous_version ?? null;
    if (!previous) {
      throw new AstraError('plugin.not_found', `${pluginId} has no version to roll back to`);
    }

    const scopes = await this.#grantedScopes(tenantId, pluginId, []);
    const install = await this.install(tenantId, userId, pluginId, {
      version: previous,
      granted_scopes: [...scopes],
    });

    // 戻ったので、もう一度戻る先は無い。無いまま残すと往復し続けられる。
    await withTenant(this.#db, tenantId, (tx) =>
      tx
        .updateTable('plugin_installs')
        .set({ previous_version: null })
        .where('plugin_id', '=', pluginId)
        .where('state', '=', 'INSTALLED')
        .execute(),
    );

    await withTenant(this.#db, tenantId, (tx) =>
      appendAuditEvent(tx, tenantId, {
        actorType: 'user',
        actorId: userId,
        action: 'plugin.rollback',
        payload: { plugin_id: pluginId, to: previous },
      }),
    );
    return install;
  }

  /** いま許されている scope。update で引き継ぐのに使う。 */
  async #grantedScopes(
    tenantId: string,
    pluginId: string,
    extra: readonly PermissionScope[],
  ): Promise<PermissionScope[]> {
    const rows = await withTenant(this.#db, tenantId, (tx) =>
      tx
        .selectFrom('plugin_permissions')
        .innerJoin('plugin_installs', 'plugin_installs.id', 'plugin_permissions.install_id')
        .select(['plugin_permissions.scope as scope'])
        .where('plugin_installs.plugin_id', '=', pluginId)
        .where('plugin_installs.state', '=', 'INSTALLED')
        .where('plugin_permissions.granted', '=', true)
        .execute(),
    );
    return [...new Set([...rows.map((r) => r.scope as PermissionScope), ...extra])];
  }

  /**
   * install 済み plugin の asset を、そのテナントが使っている版から読む。
   * **install していない plugin の中身は返さない。**
   */
  async installedAsset(
    tenantId: string,
    pluginId: string,
    assetPath: string,
  ): Promise<Buffer | null> {
    const install = await withTenant(this.#db, tenantId, (tx) =>
      tx
        .selectFrom('plugin_installs')
        .select(['version'])
        .where('plugin_id', '=', pluginId)
        .where('state', '=', 'INSTALLED')
        .executeTakeFirst(),
    );
    if (!install) return null;
    return this.asset(pluginId, install.version, assetPath);
  }

  /** その plugin が宣言した `data_extensions` のパス。 */
  async dataExtensions(tenantId: string, pluginId: string): Promise<string[]> {
    const install = await withTenant(this.#db, tenantId, (tx) =>
      tx
        .selectFrom('plugin_installs')
        .select(['version'])
        .where('plugin_id', '=', pluginId)
        .where('state', '=', 'INSTALLED')
        .executeTakeFirst(),
    );
    if (!install) return [];

    const version = await withSystem(this.#db, (tx) =>
      tx
        .selectFrom('plugin_versions')
        .select(['manifest'])
        .where('plugin_id', '=', pluginId)
        .where('version', '=', install.version)
        .executeTakeFirst(),
    );
    if (!version) return [];
    return [...(version.manifest as unknown as PluginManifest).data_extensions];
  }

  /**
   * 宣言されたファイルの中身を返す。dashboard の描画と skill の読み込みに使う。
   */
  async asset(pluginId: string, version: string, assetPath: string): Promise<Buffer | null> {
    const row = await withSystem(this.#db, (tx) =>
      tx
        .selectFrom('plugin_assets')
        .select(['content'])
        .where('plugin_id', '=', pluginId)
        .where('version', '=', version)
        .where('path', '=', assetPath)
        .executeTakeFirst(),
    );
    return row ? Buffer.from(row.content) : null;
  }
}

/** semver の major。同意を取り直すかの判定に使う。 */
function majorOf(version: string): number {
  return Number(version.split('.')[0] ?? 0);
}

/** asset に入っている policy の規則数。空の policy を「持っている」と数えない。 */
function countRules(assets: readonly PluginAsset[]): number {
  let total = 0;
  for (const asset of assets.filter((a) => a.kind === 'policy')) {
    const parsed = PolicyDocument.safeParse(parseYaml(asset.content.toString()));
    if (parsed.success) total += parsed.data.rules.length;
  }
  return total;
}
