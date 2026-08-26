/**
 * Plugin カタログの HTTP 表面。実装仕様 §9.3・§11。
 *
 * Phase 0 は参照と install 記録まで。実行は Phase 4。
 */
import { z } from 'zod';
import { AstraError, InstallPluginRequest, PermissionScope, Semver } from '@astra/contracts';
import { NO_DATA_SOURCES } from '@astra/service-plugin-registry';
import type { ConnectionService } from '@astra/service-plugin-registry';
import type { DataSourceResolver, PluginRegistryService } from '@astra/service-plugin-registry';
import type { App } from '../fastify.js';
import { requirePrincipal } from '../auth/middleware.js';

export interface PluginRouteDeps {
  readonly registry: PluginRegistryService;
  /** connector の接続状態（正本 §2.4）。 */
  readonly connections?: ConnectionService;
  /** dashboard の bind を解決する先。未設定なら全部 unavailable になる。 */
  readonly dataSources?: DataSourceResolver;
}

/**
 * 繋ぐときに渡すのは**参照だけ**。値そのものは受け取らない（正本 §21）。
 * 実際の OAuth 交換は端末側（Keychain / Secret Manager）で行い、
 * ここへはその置き場所が来る。
 */
const ConnectRequest = z.object({
  connector_id: z.string().min(1),
  credential_ref: z.string().min(1).max(200),
  granted_scopes: z.array(z.string()).default([]),
  account_label: z.string().max(200).nullable().default(null),
  expires_at: z.string().nullable().default(null),
});

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

  app.get<{ Params: { pluginId: string } }>(
    '/v1/plugins/:pluginId/connections',
    async (request) => {
      const principal = requirePrincipal();
      if (!deps.connections) return { items: [] };
      return {
        items: await deps.connections.list(principal.tenantId, request.params.pluginId),
      };
    },
  );

  app.post<{ Params: { pluginId: string } }>(
    '/v1/plugins/:pluginId/connect',
    async (request, reply) => {
      const principal = requirePrincipal();
      if (!deps.connections) {
        throw new AstraError('host.not_connected', 'connections are not available here');
      }
      const body = ConnectRequest.parse(request.body ?? {});
      const connection = await deps.connections.connect({
        tenantId: principal.tenantId,
        userId: principal.userId,
        pluginId: request.params.pluginId,
        connectorId: body.connector_id,
        credentialRef: body.credential_ref,
        grantedScopes: body.granted_scopes,
        accountLabel: body.account_label,
        expiresAt: body.expires_at,
      });
      return reply.status(201).send(connection);
    },
  );

  app.delete<{ Params: { pluginId: string; connectorId: string } }>(
    '/v1/plugins/:pluginId/connections/:connectorId',
    async (request, reply) => {
      const principal = requirePrincipal();
      if (!deps.connections) {
        throw new AstraError('host.not_connected', 'connections are not available here');
      }
      await deps.connections.disconnect(
        principal.tenantId,
        request.params.pluginId,
        request.params.connectorId,
      );
      return reply.status(204).send();
    },
  );

  app.delete<{ Params: { pluginId: string } }>('/v1/plugins/:pluginId', async (request, reply) => {
    const principal = requirePrincipal();
    await deps.registry.uninstall(principal.tenantId, principal.userId, request.params.pluginId);
    return reply.status(204).send();
  });
}
