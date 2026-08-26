/**
 * 手元の実行基盤の HTTP 表面。正本 §4.4・§16.1。
 *
 * **任意コマンド実行の口にしない。**ここにあるのは、
 * 名乗る・借りる・延ばす・返す・途中を残す・戻す、だけ。
 */
import { z } from 'zod';
import { AstraError } from '@astra/contracts';
import type { AgentHostService } from '@astra/service-agent-host';
import type { TaskService } from '@astra/service-task';
import type { App } from '../fastify.js';
import { requirePrincipal } from '../auth/middleware.js';

export interface AgentHostRouteDeps {
  readonly hosts: AgentHostService;
  readonly tasks: TaskService;
}

const HeartbeatRequest = z.object({
  device_label: z.string().min(1).max(200),
  /** この端末で使えるモデル。**空なら仕事を渡さない。** */
  models: z.array(z.string()).default([]),
  capabilities: z.record(z.string(), z.unknown()).default({}),
});

const ClaimRequest = z.object({ host_id: z.uuid() });
const LeaseRequest = z.object({ lease_id: z.uuid() });
const CheckpointRequest = z.object({
  lease_id: z.uuid(),
  step_index: z.number().int().min(0),
  state: z.record(z.string(), z.unknown()).default({}),
});

export function registerAgentHostRoutes(app: App, deps: AgentHostRouteDeps): void {
  app.post('/v1/agent-hosts/heartbeat', async (request) => {
    const principal = requirePrincipal();
    const body = HeartbeatRequest.parse(request.body ?? {});
    return deps.hosts.heartbeat({
      tenantId: principal.tenantId,
      userId: principal.userId,
      deviceLabel: body.device_label,
      models: body.models,
      capabilities: body.capabilities,
    });
  });

  app.get('/v1/agent-hosts', async () => {
    const principal = requirePrincipal();
    return { items: await deps.hosts.hosts(principal.tenantId, principal.userId) };
  });

  app.post<{ Params: { taskId: string } }>('/v1/tasks/:taskId/lease', async (request, reply) => {
    const principal = requirePrincipal();
    const body = ClaimRequest.parse(request.body ?? {});
    // 他テナントの仕事を借りられないよう、まず存在を通す
    await deps.tasks.get(principal.tenantId, request.params.taskId);
    const lease = await deps.hosts.claim({
      tenantId: principal.tenantId,
      taskId: request.params.taskId,
      hostId: body.host_id,
    });
    return reply.status(201).send(lease);
  });

  app.post<{ Params: { taskId: string } }>('/v1/tasks/:taskId/lease/renew', async (request) => {
    const principal = requirePrincipal();
    const body = LeaseRequest.parse(request.body ?? {});
    return deps.hosts.renew({
      tenantId: principal.tenantId,
      taskId: request.params.taskId,
      leaseId: body.lease_id,
    });
  });

  app.delete<{ Params: { taskId: string } }>('/v1/tasks/:taskId/lease', async (request, reply) => {
    const principal = requirePrincipal();
    const body = LeaseRequest.parse(request.body ?? {});
    await deps.hosts.release({
      tenantId: principal.tenantId,
      taskId: request.params.taskId,
      leaseId: body.lease_id,
    });
    return reply.status(204).send();
  });

  app.post<{ Params: { taskId: string } }>(
    '/v1/tasks/:taskId/checkpoint',
    async (request, reply) => {
      const principal = requirePrincipal();
      const body = CheckpointRequest.parse(request.body ?? {});
      await deps.hosts.checkpoint({
        tenantId: principal.tenantId,
        taskId: request.params.taskId,
        leaseId: body.lease_id,
        stepIndex: body.step_index,
        state: body.state,
      });
      return reply.status(204).send();
    },
  );

  app.get<{ Params: { taskId: string } }>('/v1/tasks/:taskId/checkpoint', async (request) => {
    const principal = requirePrincipal();
    await deps.tasks.get(principal.tenantId, request.params.taskId);
    const checkpoint = await deps.hosts.lastCheckpoint(principal.tenantId, request.params.taskId);
    // 無いことを空の checkpoint にしない（「0 まで進んだ」と読まれる）
    if (!checkpoint) throw new AstraError('common.not_found', 'no checkpoint yet');
    return checkpoint;
  });

  app.post<{ Params: { taskId: string } }>('/v1/tasks/:taskId/resume', async (request) => {
    const principal = requirePrincipal();
    const body = ClaimRequest.parse(request.body ?? {});
    const task = await deps.tasks.get(principal.tenantId, request.params.taskId);
    return deps.hosts.resume({
      tenantId: principal.tenantId,
      taskId: request.params.taskId,
      hostId: body.host_id,
      // 止まる前に承認待ちだったかは、task の状態から見る
      wasWaitingApproval: task.status === 'WAITING_APPROVAL',
    });
  });
}
