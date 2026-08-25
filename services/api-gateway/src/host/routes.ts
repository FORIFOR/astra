/**
 * WS /v1/host/bridge。実装仕様 §10.1・§10.2。
 *
 * device token でのみ接続を許す。アクセストークンでホスト実行を呼べてはならない
 * （漏れた REST 用トークンで OS 操作が走らないようにするため）。
 */
import {
  AstraError,
  type AccessTokenClaims,
  HOST_HEARTBEAT_INTERVAL_MS,
  HOST_HEARTBEAT_TIMEOUT_MS,
  HOST_PROTOCOL,
  HostMessage,
} from '@astra/contracts';
import type { Logger } from '@astra/telemetry';
import type { App } from '../fastify.js';
import { bearerToken, type TokenVerifier } from '../auth/tokens.js';
import type { HostBridge, HostSocket } from './bridge.js';

export interface HostRouteDeps {
  readonly bridge: HostBridge;
  readonly tokens: TokenVerifier;
  readonly logger: Logger;
  readonly heartbeatIntervalMs?: number;
  readonly heartbeatTimeoutMs?: number;
}

/**
 * トークンを取り出す。
 *
 * ブラウザの WebSocket は独自ヘッダを付けられないので、`Sec-WebSocket-Protocol` に
 * `astra.host.v1, bearer.<token>` の形で載せる経路も認める。
 * Node のクライアントは `Authorization` を使える。
 */
export function extractDeviceToken(headers: {
  authorization?: string | undefined;
  'sec-websocket-protocol'?: string | undefined;
}): string | null {
  const fromHeader = bearerToken(headers.authorization);
  if (fromHeader) return fromHeader;

  const protocols = (headers['sec-websocket-protocol'] ?? '')
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean);
  if (!protocols.includes(HOST_PROTOCOL)) return null;
  const bearer = protocols.find((p) => p.startsWith('bearer.'));
  return bearer ? bearer.slice('bearer.'.length) : null;
}

declare module 'fastify' {
  interface FastifyRequest {
    /** preValidation が確定させた device token のクレーム。 */
    deviceClaims?: AccessTokenClaims;
  }
}

export function registerHostRoutes(app: App, deps: HostRouteDeps): void {
  const heartbeatInterval = deps.heartbeatIntervalMs ?? HOST_HEARTBEAT_INTERVAL_MS;
  const heartbeatTimeout = deps.heartbeatTimeoutMs ?? HOST_HEARTBEAT_TIMEOUT_MS;

  const reaper = setInterval(() => {
    for (const deviceId of deps.bridge.reapStale(heartbeatTimeout)) {
      deps.logger.warn({ device_id: deviceId }, 'host bridge heartbeat timeout');
    }
  }, heartbeatInterval);
  reaper.unref();
  app.addHook('onClose', async () => clearInterval(reaper));

  app.get(
    '/v1/host/bridge',
    {
      websocket: true,
      config: { auth: false, rateLimit: false },
      /**
       * 認証は **upgrade の前**に済ませる。接続を受け入れてから閉じると、
       * クライアントには「開いた直後に切れた」としか見えず、原因が分からない。
       * ここで返せば通常の 401 として扱える。
       */
      preValidation: async (request, reply) => {
        const token = extractDeviceToken({
          authorization: request.headers.authorization,
          'sec-websocket-protocol': request.headers['sec-websocket-protocol'],
        });
        if (!token) {
          return reply.status(401).send({
            error: {
              code: 'auth.missing_token',
              message: 'device token required on the host bridge',
              request_id: request.id,
            },
          });
        }
        try {
          // aud が host-bridge のトークンでなければここで落ちる。
          // REST 用のアクセストークンで OS 操作の経路に入れてはいけない（§10.1）。
          request.deviceClaims = await deps.tokens.verifyDeviceToken(token);
        } catch {
          return reply.status(401).send({
            error: {
              code: 'auth.invalid_token',
              message: 'device token is not valid for the host bridge',
              request_id: request.id,
            },
          });
        }
        return undefined;
      },
    },
    (connection, request) => {
      const socket = connection as unknown as HostSocket & {
        on(event: string, listener: (...args: unknown[]) => void): void;
      };
      const claims = request.deviceClaims;
      if (!claims) {
        // preValidation を通っていない = 配線ミス
        socket.close(4401, 'device token required');
        return;
      }

      deps.bridge.attach({
        deviceId: claims.did,
        tenantId: claims.tid,
        userId: claims.sub,
        socket,
      });
      deps.logger.info({ device_id: claims.did, tenant_id: claims.tid }, 'host bridge attached');

      socket.on('message', (raw: unknown) => {
        let parsed;
        try {
          parsed = HostMessage.parse(JSON.parse(String(raw)));
        } catch {
          // 契約外のフレームは無視する。切断すると、版ずれのクライアントが
          // 何度も繋ぎ直して騒がしくなる。
          deps.logger.warn({ device_id: claims.did }, 'unparseable host frame');
          return;
        }

        deps.bridge.touch(claims.did);

        switch (parsed.type) {
          case 'host.hello':
            if (parsed.device_id !== claims.did) {
              // トークンの device と名乗りが食い違う接続は信用しない
              socket.close(4403, 'device mismatch');
              return;
            }
            deps.bridge.declareCapabilities(claims.did, parsed.capabilities);
            return;
          case 'host.result':
            deps.bridge.settle(
              claims.did,
              parsed.call_id,
              parsed.ok ? { ok: true, value: parsed.value } : { ok: false, error: parsed.error },
            );
            return;
          case 'host.ping':
            socket.send(JSON.stringify({ type: 'host.pong' }));
            return;
          default:
            return;
        }
      });

      const detach = (): void => {
        deps.bridge.detach(claims.did, socket);
        deps.logger.info({ device_id: claims.did }, 'host bridge detached');
      };
      socket.on('close', detach);
      socket.on('error', detach);
    },
  );
}

/** テストと診断用。Phase 0 のホストが申告すべき最小集合。 */
export function assertPhase0Capability(capability: string): void {
  if (capability !== 'host.ping' && capability !== 'host.system.info') {
    throw new AstraError('host.capability_denied', `${capability} is not available in Phase 0`);
  }
}
