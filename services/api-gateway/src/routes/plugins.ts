/**
 * Plugin カタログの HTTP 表面。実装仕様 §9.3・§11。
 *
 * Phase 0 は参照と install 記録まで。実行は Phase 4。
 */
import { InstallPluginRequest } from '@astra/contracts';
import type { PluginRegistryService } from '@astra/service-plugin-registry';
import type { App } from '../fastify.js';
import { requirePrincipal } from '../auth/middleware.js';

export interface PluginRouteDeps {
  readonly registry: PluginRegistryService;
}

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

  app.delete<{ Params: { pluginId: string } }>('/v1/plugins/:pluginId', async (request, reply) => {
    const principal = requirePrincipal();
    await deps.registry.uninstall(principal.tenantId, principal.userId, request.params.pluginId);
    return reply.status(204).send();
  });
}
