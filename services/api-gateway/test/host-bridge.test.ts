/**
 * Local Host Bridge。実装仕様 §10、受け入れテスト AC-14。
 *
 * 実際に WebSocket を張るので listen する（inject では WS を試せない）。
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { HOST_PROTOCOL, uuidv7, type TokenResponse } from '@astra/contracts';
import { makeTestApp, makeTokens, testDbConfig, type TestApp } from './support.js';
import { HostBridge } from '../src/host/bridge.js';
import { extractDeviceToken } from '../src/host/routes.js';
import type { App } from '../src/fastify.js';
import type { JwtTokens } from '../src/auth/tokens.js';

const url = process.env['TEST_DATABASE_URL'];
const identityUrl = process.env['TEST_IDENTITY_DATABASE_URL'];

const PHASE0_CAPABILITIES = ['host.ping', 'host.system.info'];

describe('extractDeviceToken', () => {
  it('prefers the Authorization header', () => {
    expect(extractDeviceToken({ authorization: 'Bearer abc' })).toBe('abc');
  });

  it('accepts the subprotocol form browsers are stuck with', () => {
    expect(extractDeviceToken({ 'sec-websocket-protocol': `${HOST_PROTOCOL}, bearer.xyz` })).toBe(
      'xyz',
    );
  });

  it('refuses a subprotocol list without our protocol', () => {
    expect(extractDeviceToken({ 'sec-websocket-protocol': 'bearer.xyz' })).toBeNull();
    expect(extractDeviceToken({})).toBeNull();
  });
});

describe('HostBridge', () => {
  const socket = () => {
    const sent: string[] = [];
    let closed: { code: number | undefined; reason: string | undefined } | null = null;
    return {
      sent,
      get closed() {
        return closed;
      },
      send: (data: string) => sent.push(data),
      close: (code?: number, reason?: string) => {
        closed = { code, reason };
      },
    };
  };

  const attach = (bridge: HostBridge, deviceId: string, s: ReturnType<typeof socket>) => {
    bridge.attach({ deviceId, tenantId: uuidv7(), userId: uuidv7(), socket: s });
    bridge.declareCapabilities(deviceId, PHASE0_CAPABILITIES);
  };

  it('refuses a capability the host never declared', async () => {
    const bridge = new HostBridge();
    const deviceId = uuidv7();
    attach(bridge, deviceId, socket());
    await expect(
      bridge.call(deviceId, { capability: 'files.delete', risk: 'READ' }),
    ).rejects.toThrow(/did not declare/);
  });

  it('refuses a non-READ call with no approved decision', async () => {
    const bridge = new HostBridge();
    const deviceId = uuidv7();
    attach(bridge, deviceId, socket());
    await expect(
      bridge.call(deviceId, { capability: 'host.system.info', risk: 'DESTRUCTIVE' }),
    ).rejects.toThrow(/requires an approved decision/);
  });

  it('refuses when nothing is connected', async () => {
    const bridge = new HostBridge();
    await expect(bridge.call(uuidv7(), { capability: 'host.ping', risk: 'READ' })).rejects.toThrow(
      /not connected/,
    );
  });

  it('round-trips a call and its result', async () => {
    const bridge = new HostBridge();
    const deviceId = uuidv7();
    const s = socket();
    attach(bridge, deviceId, s);

    const pending = bridge.call(deviceId, { capability: 'host.ping', risk: 'READ' });
    const frame = JSON.parse(s.sent[0]!) as { call_id: string; capability: string };
    expect(frame.capability).toBe('host.ping');

    bridge.settle(deviceId, frame.call_id, { ok: true, value: { pong: true } });
    await expect(pending).resolves.toEqual({ pong: true });
  });

  it('times out without retrying', async () => {
    // 実装仕様 §10.4: ホスト側で副作用が起きたか分からない以上、勝手に二重実行させない
    const bridge = new HostBridge();
    const deviceId = uuidv7();
    const s = socket();
    attach(bridge, deviceId, s);

    await expect(
      bridge.call(deviceId, { capability: 'host.ping', risk: 'READ', deadlineMs: 20 }),
    ).rejects.toThrow(/timed out/);
    expect(s.sent).toHaveLength(1);
  });

  it('drops a second connection for the same device', () => {
    const bridge = new HostBridge();
    const deviceId = uuidv7();
    const first = socket();
    const second = socket();
    attach(bridge, deviceId, first);
    attach(bridge, deviceId, second);
    expect(first.closed?.code).toBe(4000);
    expect(bridge.isConnected(deviceId)).toBe(true);
  });

  it('ignores a close from a socket that was already replaced', () => {
    const bridge = new HostBridge();
    const deviceId = uuidv7();
    const first = socket();
    const second = socket();
    attach(bridge, deviceId, first);
    attach(bridge, deviceId, second);
    bridge.detach(deviceId, first);
    expect(bridge.isConnected(deviceId)).toBe(true);
    bridge.detach(deviceId, second);
    expect(bridge.isConnected(deviceId)).toBe(false);
  });

  it('fails everything in flight when the host goes away', async () => {
    const bridge = new HostBridge();
    const deviceId = uuidv7();
    attach(bridge, deviceId, socket());
    const pending = bridge.call(deviceId, { capability: 'host.ping', risk: 'READ' });
    bridge.detach(deviceId);
    await expect(pending).rejects.toThrow(/disconnected/);
  });

  it('reaps a connection that stopped answering', () => {
    let clock = 1_000;
    const bridge = new HostBridge({ now: () => clock });
    const deviceId = uuidv7();
    const s = socket();
    attach(bridge, deviceId, s);
    clock += 70_000;
    expect(bridge.reapStale(60_000)).toEqual([deviceId]);
    expect(s.closed?.code).toBe(4001);
    expect(bridge.isConnected(deviceId)).toBe(false);
  });

  it('ignores a result for a call it does not know about', () => {
    const bridge = new HostBridge();
    const deviceId = uuidv7();
    attach(bridge, deviceId, socket());
    expect(() => bridge.settle(deviceId, uuidv7(), { ok: true, value: 1 })).not.toThrow();
  });
});

describe.skipIf(!url)('host bridge over a real socket', () => {
  let harness: TestApp;
  let app: App;
  let tokens: JwtTokens;
  let bridge: HostBridge;
  let baseUrl: string;
  let deviceToken: string;
  let deviceId: string;

  const connect = (token: string): WebSocket =>
    new WebSocket(`${baseUrl}/v1/host/bridge`, [HOST_PROTOCOL, `bearer.${token}`]);

  const waitOpen = (ws: WebSocket): Promise<void> =>
    new Promise((resolve, reject) => {
      ws.once('open', () => resolve());
      ws.once('error', reject);
      ws.once('close', (code) => reject(new Error(`closed with ${code}`)));
    });

  beforeAll(async () => {
    tokens = await makeTokens();
    bridge = new HostBridge();
    harness = await makeTestApp({
      dbConfig: testDbConfig(url!, identityUrl),
      tokens,
      bridge,
    });
    app = harness.app;
    await app.listen({ port: 0, host: '127.0.0.1' });
    const address = app.server.address();
    baseUrl = `ws://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;

    const issued = await app.inject({
      method: 'POST',
      url: '/v1/auth/dev/token',
      payload: { email: `h-${uuidv7()}@example.com`, display_name: 'H' },
    });
    const body = issued.json<TokenResponse>();
    deviceToken = body.device_token;
    const me = await app.inject({
      method: 'GET',
      url: '/v1/me',
      headers: { authorization: `Bearer ${body.access_token}` },
    });
    deviceId = me.json<{ device: { id: string } }>().device.id;
  });

  afterAll(async () => {
    await harness?.close();
  });

  it('accepts a device token and completes host.ping (AC-14)', async () => {
    const ws = connect(deviceToken);
    await waitOpen(ws);
    ws.send(
      JSON.stringify({
        type: 'host.hello',
        device_id: deviceId,
        app_version: '0.1.0',
        platform: 'macos',
        capabilities: PHASE0_CAPABILITIES,
      }),
    );

    // hello が届くまで待つ
    for (let i = 0; i < 50 && !bridge.isConnected(deviceId); i += 1) {
      await new Promise((r) => setTimeout(r, 20));
    }
    for (let i = 0; i < 50 && bridge.capabilitiesOf(deviceId).length === 0; i += 1) {
      await new Promise((r) => setTimeout(r, 20));
    }
    expect(bridge.capabilitiesOf(deviceId).sort()).toEqual(PHASE0_CAPABILITIES);

    ws.on('message', (raw) => {
      const frame = JSON.parse(String(raw)) as { type: string; call_id?: string };
      if (frame.type === 'host.call') {
        ws.send(
          JSON.stringify({
            type: 'host.result',
            call_id: frame.call_id,
            ok: true,
            value: { pong: true },
          }),
        );
      }
    });

    await expect(
      bridge.call(deviceId, { capability: 'host.ping', risk: 'READ', deadlineMs: 5_000 }),
    ).resolves.toEqual({ pong: true });

    ws.close();
  }, 30_000);

  it('refuses a plain access token before upgrading', async () => {
    const issued = await app.inject({
      method: 'POST',
      url: '/v1/auth/dev/token',
      payload: { email: `h2-${uuidv7()}@example.com`, display_name: 'H2' },
    });
    // REST 用のトークンで OS 操作の経路に入れてはいけない（実装仕様 §10.1）。
    // 受け入れてから閉じるのではなく、upgrade 前に 401 を返す。
    const ws = connect(issued.json<TokenResponse>().access_token);
    await expect(waitOpen(ws)).rejects.toThrow(/401/);
  }, 30_000);

  it('refuses a connection with no token at all', async () => {
    const ws = new WebSocket(`${baseUrl}/v1/host/bridge`, [HOST_PROTOCOL]);
    await expect(waitOpen(ws)).rejects.toThrow(/401/);
  }, 30_000);
});
