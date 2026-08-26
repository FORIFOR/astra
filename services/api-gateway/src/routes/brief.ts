/**
 * 「今日気にすべきこと」の HTTP 表面。正本 §2.1、Phase 6 実装仕様 §4。
 *
 * **Home に KPI を置かない**（UI/UX §8.1）。ここが返すのは
 * 「いま気にすべき最大 3 件」と、その残りだけ。
 */
import { z } from 'zod';
import { CommitmentStatus } from '@astra/contracts';
import type { TaskService } from '@astra/service-task';
import type { MeetingService } from '@astra/service-meeting';
import { buildBrief, type WorldModelService } from '@astra/service-world-model';
import type { App } from '../fastify.js';
import { requirePrincipal } from '../auth/middleware.js';

export interface BriefRouteDeps {
  readonly world: WorldModelService;
  readonly tasks: TaskService;
  readonly meetings?: MeetingService;
  readonly now?: () => Date;
}

const SettleRequest = z.object({
  status: CommitmentStatus.exclude(['OPEN']),
});

export function registerBriefRoutes(app: App, deps: BriefRouteDeps): void {
  const now = deps.now ?? (() => new Date());

  app.get('/v1/brief', async () => {
    const principal = requirePrincipal();

    // 片方が落ちても、取れたほうは出す。全部か無かにしない。
    const [commitments, tasks, meetings] = await Promise.all([
      deps.world.openCommitments(principal.tenantId).catch(() => []),
      deps.tasks.list(principal.tenantId, 50).catch(() => ({ items: [] })),
      deps.meetings?.list(principal.tenantId).catch(() => []) ?? Promise.resolve([]),
    ]);

    return buildBrief({
      commitments,
      tasks: tasks.items.map((t) => ({
        id: t.id,
        title: t.title ?? null,
        status: t.status,
        updatedAt: t.updated_at,
      })),
      meetings: meetings
        .filter((m) => m.status === 'RECORDING' || m.status === 'PAUSED')
        .map((m) => ({ id: m.id, title: m.title, startsAt: m.started_at })),
      now: now(),
    });
  });

  app.get('/v1/commitments', async () => {
    const principal = requirePrincipal();
    return { items: await deps.world.openCommitments(principal.tenantId) };
  });

  app.post<{ Params: { factId: string } }>('/v1/commitments/:factId/settle', async (request) => {
    const principal = requirePrincipal();
    const body = SettleRequest.parse(request.body ?? {});
    // 消さずに残す。「やらないことにした」も記録。
    return deps.world.settle(principal.tenantId, request.params.factId, body.status);
  });
}
