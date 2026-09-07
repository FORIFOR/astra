/**
 * Work Context / Personalization の HTTP 表面。正本 §6・§10、Phase 6。
 *
 *   GET  /v1/work/context            Home の「今日、気にした方がいいこと」「待っていること」「返すもの」「今週の負荷」
 *   GET  /v1/work/evidence/:itemId   その item の出所（artifact そのもの。抜粋だけ、全文は無い）
 *   POST /v1/work/corrections        本人の訂正（1 操作）
 *   POST /v1/work/artifacts          端末の worker からの取り込み（正規化済み。全文は来ない）
 *   GET  /v1/work/sync               source ごとの同期位置
 *   GET  /v1/personalization         Astra が今あなたについて使っている情報
 *   PUT  /v1/personalization         確認・使わない・全体の停止
 *
 * Astra 自身の task と会議も同じ artifact として混ぜる（cross-source）。
 */
import {
  PersonalizationUpdate,
  WorkArtifactBatch,
  WorkCorrection,
  type WorkArtifact,
} from '@astra/contracts';
import type { TaskService } from '@astra/service-task';
import type { MeetingService } from '@astra/service-meeting';
import type { WorkContextService } from '@astra/service-world-model';
import type { App } from '../fastify.js';
import { requirePrincipal } from '../auth/middleware.js';

export interface WorkRouteDeps {
  readonly work: WorkContextService;
  readonly tasks: TaskService;
  readonly meetings?: MeetingService;
}

/** Astra の task と会議を、同じ形にする（端末からは来ない、cloud が持っているもの）。 */
export async function localArtifacts(
  deps: WorkRouteDeps,
  tenantId: string,
): Promise<WorkArtifact[]> {
  const out: WorkArtifact[] = [];
  const tasks = await deps.tasks
    .list(tenantId, 50)
    .catch(() => ({
      items: [] as {
        id: string;
        title: string | null;
        status: string;
        updated_at: string;
        created_at?: string;
      }[],
    }));
  for (const t of tasks.items) {
    if (!t.title) continue;
    const open = !['COMPLETED', 'FAILED', 'CANCELLED'].includes(t.status);
    out.push({
      id: 'astra_task:' + t.id,
      source: 'astra_task',
      kind: 'task',
      title: t.title,
      body_excerpt: null,
      people: [],
      direction: 'self',
      occurred_at: t.updated_at,
      ends_at: null,
      due_at: null,
      thread_id: null,
      project_hint: null,
      responded: null,
      completed: !open,
      provenance: {
        source: 'astra_task',
        external_id: t.id,
        label: t.title,
        observed_at: t.updated_at,
        url: null,
        excerpt: null,
      },
      semantic: null,
    });
  }
  const meetings = (await deps.meetings?.list(tenantId, 30).catch(() => [])) ?? [];
  for (const m of meetings) {
    out.push({
      id: 'meeting:' + m.id,
      source: 'meeting',
      kind: 'meeting',
      title: m.title,
      body_excerpt: null,
      people: [],
      direction: 'self',
      occurred_at: m.started_at,
      ends_at: m.ended_at ?? null,
      due_at: null,
      thread_id: null,
      project_hint: null,
      responded: null,
      completed: null,
      provenance: {
        source: 'meeting',
        external_id: m.id,
        label: m.title,
        observed_at: m.started_at,
        url: null,
        excerpt: null,
      },
      semantic: null,
    });
  }
  return out;
}

export function registerWorkRoutes(app: App, deps: WorkRouteDeps): void {
  app.get('/v1/work/context', async () => {
    const p = requirePrincipal();
    return deps.work.context(p.tenantId, p.userId, await localArtifacts(deps, p.tenantId));
  });

  app.get<{ Params: { itemId: string } }>('/v1/work/evidence/:itemId', async (request) => {
    const p = requirePrincipal();
    return {
      items: await deps.work.evidence(
        p.tenantId,
        p.userId,
        request.params.itemId,
        await localArtifacts(deps, p.tenantId),
      ),
    };
  });

  app.post('/v1/work/corrections', async (request, reply) => {
    const p = requirePrincipal();
    await deps.work.correct(p.tenantId, p.userId, WorkCorrection.parse(request.body ?? {}));
    return reply.status(204).send();
  });

  app.post('/v1/work/artifacts', async (request, reply) => {
    const p = requirePrincipal();
    const batch = WorkArtifactBatch.parse(request.body ?? {});
    const result = await deps.work.ingest(p.tenantId, p.userId, batch);
    return reply.status(202).send(result);
  });

  app.get('/v1/work/sync', async () => {
    const p = requirePrincipal();
    return { items: await deps.work.syncState(p.tenantId, p.userId) };
  });

  app.get('/v1/personalization', async () => {
    const p = requirePrincipal();
    return deps.work.personalization(p.tenantId, p.userId);
  });

  app.put('/v1/personalization', async (request) => {
    const p = requirePrincipal();
    return deps.work.updateProfile(
      p.tenantId,
      p.userId,
      PersonalizationUpdate.parse(request.body ?? {}),
    );
  });
}
