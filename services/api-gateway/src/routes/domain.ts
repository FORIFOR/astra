/**
 * Domain entity の HTTP 表面。Phase 5 実装仕様 §5。
 *
 * **entity の定義は plugin が持つ。**gateway は「どの定義で検査するか」を
 * registry から引いてから service へ渡す。定義を知らずに受けると、
 * 何でも書き込める口になる。
 */
import { z } from 'zod';
import { AstraError, EntityDef } from '@astra/contracts';
import type { DomainService } from '@astra/service-agent-runtime';
import type { App } from '../fastify.js';
import { requirePrincipal } from '../auth/middleware.js';

/** plugin id → entity 型 → 定義。組み立て側が渡す。 */
export type EntityDefLookup = (
  tenantId: string,
  pluginId: string,
  entityType: string,
) => Promise<EntityDef | null>;

export interface DomainRouteDeps {
  readonly domain: DomainService;
  readonly definitions: EntityDefLookup;
}

const CreateEntity = z.object({
  fields: z.record(z.string(), z.unknown()),
  source_task_id: z.string().nullable().optional(),
  source_meeting_id: z.string().nullable().optional(),
});

const LinkRequest = z.object({
  to_id: z.uuid(),
  relation: z.string().regex(/^[a-z][a-z0-9_]*$/),
});

export function registerDomainRoutes(app: App, deps: DomainRouteDeps): void {
  type Params = { pluginId: string; entityType: string };

  const defOf = async (tenantId: string, params: Params): Promise<EntityDef> => {
    const def = await deps.definitions(tenantId, params.pluginId, params.entityType);
    // install していない plugin の entity は「無い」（AC5-6 と同じ扱い）
    if (!def) {
      throw new AstraError(
        'plugin.not_found',
        `no entity "${params.entityType}" from ${params.pluginId}`,
      );
    }
    return def;
  };

  app.post<{ Params: Params }>(
    '/v1/plugins/:pluginId/entities/:entityType',
    async (request, reply) => {
      const principal = requirePrincipal();
      const def = await defOf(principal.tenantId, request.params);
      const body = CreateEntity.parse(request.body ?? {});

      const created = await deps.domain.create({
        tenantId: principal.tenantId,
        userId: principal.userId,
        pluginId: request.params.pluginId,
        def,
        fields: body.fields,
        sourceTaskId: body.source_task_id ?? null,
        sourceMeetingId: body.source_meeting_id ?? null,
      });
      return reply.status(201).send(created);
    },
  );

  app.get<{ Params: Params }>('/v1/plugins/:pluginId/entities/:entityType', async (request) => {
    const principal = requirePrincipal();
    await defOf(principal.tenantId, request.params);
    return {
      items: await deps.domain.list(
        principal.tenantId,
        request.params.pluginId,
        request.params.entityType,
      ),
    };
  });

  app.get<{ Params: { entityId: string } }>('/v1/entities/:entityId', async (request) => {
    const principal = requirePrincipal();
    return deps.domain.get(principal.tenantId, request.params.entityId);
  });

  app.post<{ Params: { entityId: string } }>(
    '/v1/entities/:entityId/links',
    async (request, reply) => {
      const principal = requirePrincipal();
      const body = LinkRequest.parse(request.body ?? {});
      // 両端がこのテナントのものであることを確かめてから張る
      await deps.domain.get(principal.tenantId, request.params.entityId);
      await deps.domain.get(principal.tenantId, body.to_id);

      await deps.domain.link(
        principal.tenantId,
        request.params.entityId,
        body.to_id,
        body.relation,
      );
      return reply.status(204).send();
    },
  );

  app.get<{ Params: { entityId: string }; Querystring: { relation?: string } }>(
    '/v1/entities/:entityId/links',
    async (request) => {
      const principal = requirePrincipal();
      await deps.domain.get(principal.tenantId, request.params.entityId);
      const relation = request.query.relation ?? 'activity';
      return {
        items: await deps.domain.linked(principal.tenantId, request.params.entityId, relation),
      };
    },
  );
}
