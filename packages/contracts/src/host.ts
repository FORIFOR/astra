/**
 * Local Host Bridge プロトコル。正本 §16.1 / §21、実装仕様 §10。
 *
 * 設計の要:
 *   能力の最終判断はホスト（Desktop）側にある。クラウドからの指示を信用しない。
 *   これが無いと正本 §21 の local-first boundary は成立しない。
 */
import { z } from 'zod';
import { DeviceId, TaskId } from './ids.js';
import { Semver } from './primitives.js';
import { ActionRisk } from './approval.js';

export const HOST_PROTOCOL = 'astra.host.v1' as const;

/** Phase 0 の capability はこの 2 つだけ（実装仕様 §10.4）。 */
export const HOST_CAPABILITIES_PHASE0 = ['host.ping', 'host.system.info'] as const;

export const HostHello = z.object({
  type: z.literal('host.hello'),
  device_id: DeviceId,
  app_version: Semver,
  platform: z.enum(['macos', 'windows', 'linux']),
  /** ホストが実際に提供できる capability。クラウドはこの集合外を呼べない。 */
  capabilities: z.array(z.string()),
});
export type HostHello = z.infer<typeof HostHello>;

export const HostCall = z.object({
  type: z.literal('host.call'),
  call_id: z.uuid(),
  capability: z.string(),
  args: z.unknown(),
  task_id: TaskId.optional(),
  risk: ActionRisk,
  /** READ 以外は承認済み approval の ID が同伴していなければホストが拒否する。 */
  approval_id: z.uuid().optional(),
  deadline_ms: z.number().int().positive().max(600_000),
});
export type HostCall = z.infer<typeof HostCall>;

export const HostResult = z.union([
  z.object({
    type: z.literal('host.result'),
    call_id: z.uuid(),
    ok: z.literal(true),
    value: z.unknown(),
  }),
  z.object({
    type: z.literal('host.result'),
    call_id: z.uuid(),
    ok: z.literal(false),
    error: z.object({ code: z.string(), message: z.string() }),
  }),
]);
export type HostResult = z.infer<typeof HostResult>;

export const HostPing = z.object({ type: z.literal('host.ping') });
export const HostPong = z.object({ type: z.literal('host.pong') });

export const HostMessage = z.union([HostHello, HostCall, HostResult, HostPing, HostPong]);
export type HostMessage = z.infer<typeof HostMessage>;

export const HOST_HEARTBEAT_INTERVAL_MS = 20_000;
export const HOST_HEARTBEAT_TIMEOUT_MS = 60_000;
/** 処理済み call_id の保持期間。重複 call は前回結果を返す（at-most-once）。 */
export const HOST_CALL_DEDUPE_WINDOW_MS = 10 * 60_000;
