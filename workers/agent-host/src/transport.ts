/**
 * サーバとのやり取り。正本 §4.4。
 *
 * **ここは薄くしておく。**判断は `LocalAgentHost` にあり、
 * ここは HTTP に写すだけ。
 */
import type { HostTransport } from './host.js';

export interface TransportConfig {
  readonly baseUrl: string;
  readonly token: string;
  readonly fetch?: typeof globalThis.fetch;
}

export function httpTransport(config: TransportConfig): HostTransport {
  const doFetch = config.fetch ?? globalThis.fetch;

  const call = async (path: string, method: string, body?: unknown): Promise<unknown> => {
    const response = await doFetch(`${config.baseUrl}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${config.token}`,
        'content-type': 'application/json',
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (!response.ok) {
      const text = await response.text();
      // 失敗を握り潰さない。借りられなかったことは、走らない理由になる。
      throw new Error(`${method} ${path} failed with ${response.status}: ${text.slice(0, 200)}`);
    }
    return response.status === 204 ? null : ((await response.json()) as unknown);
  };

  return {
    async heartbeat(input) {
      const body = (await call('/v1/agent-hosts/heartbeat', 'POST', {
        device_label: input.deviceLabel,
        models: input.models,
      })) as { id: string };
      return { id: body.id };
    },
    async claim(taskId, hostId) {
      const body = (await call(`/v1/tasks/${taskId}/lease`, 'POST', { host_id: hostId })) as {
        leaseId: string;
        attempt: number;
      };
      return body;
    },
    async renew(taskId, leaseId) {
      await call(`/v1/tasks/${taskId}/lease/renew`, 'POST', { lease_id: leaseId });
    },
    async release(taskId, leaseId) {
      await call(`/v1/tasks/${taskId}/lease`, 'DELETE', { lease_id: leaseId });
    },
    async checkpoint(taskId, leaseId, stepIndex, state) {
      await call(`/v1/tasks/${taskId}/checkpoint`, 'POST', {
        lease_id: leaseId,
        step_index: stepIndex,
        state,
      });
    },
  };
}
