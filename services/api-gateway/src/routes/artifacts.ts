/**
 * Library の HTTP 表面。実装仕様 §8.4・§11。
 *
 * Phase 0 は作成 / 一覧 / 取得 / 本体取得まで。
 * 共有リンクは Phase 2、バージョン追加 API は Phase 1。
 */
import {
  ArtifactType,
  AstraError,
  CreateArtifactRequest,
  MAX_DIRECT_UPLOAD_BYTES,
  PageQuery,
} from '@astra/contracts';
import type { LibraryService } from '@astra/service-library';
import { z } from 'zod';
import type { App } from '../fastify.js';
import { requirePrincipal } from '../auth/middleware.js';

export interface ArtifactRouteDeps {
  readonly library: LibraryService;
}

const ArtifactListQuery = PageQuery.extend({ type: ArtifactType.optional() });

/** Phase 0 は JSON の直接アップロードのみ。multipart は Phase 1 で足す。 */
const InlineUpload = CreateArtifactRequest.extend({
  content_base64: z.string().min(1),
  file_name: z.string().max(255).optional(),
});

export function registerArtifactRoutes(app: App, deps: ArtifactRouteDeps): void {
  app.post('/v1/artifacts', async (request, reply) => {
    const principal = requirePrincipal();
    const body = InlineUpload.parse(request.body ?? {});
    const content = Buffer.from(body.content_base64, 'base64');
    if (content.byteLength > MAX_DIRECT_UPLOAD_BYTES) {
      throw new AstraError('artifact.too_large', 'artifact exceeds the direct upload limit');
    }

    const artifact = await deps.library.create({
      tenantId: principal.tenantId,
      ownerId: principal.userId,
      type: body.type,
      title: body.title,
      mimeType: body.mime_type,
      body: content,
      ...(body.file_name === undefined ? {} : { fileName: body.file_name }),
      ...(body.source_task_id === undefined ? {} : { sourceTaskId: body.source_task_id }),
      ...(body.parent_artifact_id === undefined
        ? {}
        : { parentArtifactId: body.parent_artifact_id }),
      tags: body.tags,
      sensitivity: body.sensitivity,
    });
    return reply.status(201).send(artifact);
  });

  app.get('/v1/artifacts', async (request) => {
    const principal = requirePrincipal();
    const query = ArtifactListQuery.parse(request.query ?? {});
    const page = await deps.library.list({
      tenantId: principal.tenantId,
      limit: query.limit,
      cursor: query.cursor,
      type: query.type,
    });
    return { items: page.items, next_cursor: page.nextCursor };
  });

  app.get<{ Params: { artifactId: string } }>('/v1/artifacts/:artifactId', async (request) => {
    const principal = requirePrincipal();
    return deps.library.get(principal.tenantId, request.params.artifactId);
  });

  app.get<{ Params: { artifactId: string } }>(
    '/v1/artifacts/:artifactId/content',
    async (request, reply) => {
      const principal = requirePrincipal();
      const { stream, artifact } = await deps.library.readContent(
        principal.tenantId,
        request.params.artifactId,
      );
      return (
        reply
          .header('content-type', artifact.mime_type)
          .header('content-length', String(artifact.size))
          // 本文をそのままブラウザに解釈させない。共有 viewer は Phase 2 で別 origin に置く。
          .header('content-disposition', 'attachment')
          .header('x-content-type-options', 'nosniff')
          .send(stream)
      );
    },
  );
}
