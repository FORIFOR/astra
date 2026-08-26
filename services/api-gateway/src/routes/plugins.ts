/**
 * Plugin カタログの HTTP 表面。実装仕様 §9.3・§11。
 *
 * Phase 0 は参照と install 記録まで。実行は Phase 4。
 */
import { z } from 'zod';
import { InstallPluginRequest, PermissionScope, Semver } from '@astra/contracts';
import { NO_DATA_SOURCES } from '@astra/service-plugin-registry';
import type { DataSourceResolver, PluginRegistryService } from '@astra/service-plugin-registry';
import type { App } from '../fastify.js';
import { requirePrincipal } from '../auth/middleware.js';

export interface PluginRouteDeps {
  readonly registry: PluginRegistryService;
  /** dashboard の bind を解決する先。未設定なら全部 unavailable になる。 */
  readonly dataSources?: DataSourceResolver;
}

const UpdateRequest = z.object({
  version: Semver,
  /** major 更新では同意を取り直す。増えた分をここで渡す。 */
  granted_scopes: z.array(PermissionScope).default([]),
});

export function registerPluginRoutes(app: App, deps: PluginRouteDeps): void {
  app.get('/v1/plugins/catalog', async () => {
    const principal = requirePrincipal();
    // installed / installed_version はテナントごとに違うので、カタログもテナント文脈で返す
    return { items: await deps.registry.catalog(principal.tenantId) };
  });

  app.get<{ Params: { pluginId: string } }>('/v1/plugins/:pluginId', async (request) => {
    const principal = requirePrincipal();
    return deps.registry.get(principal.tenantId, request.params.pluginId);
  });

  app.post<{ Params: { pluginId: string } }>(
    '/v1/plugins/:pluginId/install',
    async (request, reply) => {
      const principal = requirePrincipal();
      const body = InstallPluginRequest.parse(request.body ?? {});
      const install = await deps.registry.install(
        principal.tenantId,
        principal.userId,
        request.params.pluginId,
        body,
      );
      return reply.status(201).send(install);
    },
  );

  app.post<{ Params: { pluginId: string } }>('/v1/plugins/:pluginId/update', async (request) => {
    const principal = requirePrincipal();
    const body = UpdateRequest.parse(request.body ?? {});
    return deps.registry.update(
      principal.tenantId,
      principal.userId,
      request.params.pluginId,
      body.version,
      body.granted_scopes,
    );
  });

  app.post<{ Params: { pluginId: string } }>('/v1/plugins/:pluginId/rollback', async (request) => {
    const principal = requirePrincipal();
    return deps.registry.rollback(principal.tenantId, principal.userId, request.params.pluginId);
  });

  /** install しただけで増える dashboard の一覧（AC4-3）。 */
  app.get('/v1/dashboards', async () => {
    const principal = requirePrincipal();
    const items = await deps.registry.dashboards(principal.tenantId);
    return {
      items: items.map((d) => ({
        plugin_id: d.pluginId,
        plugin_name: d.pluginName,
        id: d.id,
        title: d.title,
      })),
    };
  });

  app.get<{ Params: { pluginId: string; dashboardId: string } }>(
    '/v1/plugins/:pluginId/dashboards/:dashboardId',
    async (request) => {
      const principal = requirePrincipal();
      return deps.registry.dashboardView(
        principal.tenantId,
        request.params.pluginId,
        request.params.dashboardId,
        deps.dataSources ?? NO_DATA_SOURCES,
      );
    },
  );

  app.delete<{ Params: { pluginId: string } }>('/v1/plugins/:pluginId', async (request, reply) => {
    const principal = requirePrincipal();
    await deps.registry.uninstall(principal.tenantId, principal.userId, request.params.pluginId);
    return reply.status(204).send();
  });
}
