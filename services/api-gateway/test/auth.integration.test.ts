/**
 * 認証の結合テスト。チケット P0-09 の DoD（再利用検知で全 session 失効 + audit）。
 *   ./infra/db/with-test-db.sh pnpm --filter @astra/service-api-gateway test
 */
import { Writable } from 'node:stream';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { type ApiError, type MeResponse, type TokenResponse, uuidv7 } from '@astra/contracts';
import { createDb, withTenant, type DbHandle } from '@astra/db';
import { createLogger, readAuditChain, verifyAuditChain } from '@astra/telemetry';
import { buildApp } from '../src/app.js';
import { MemoryRateLimiter } from '../src/rate-limit/memory.js';
import { loadSigningKeys } from '../src/auth/keys.js';
import { JwtTokens } from '../src/auth/tokens.js';
import { countActiveSessions } from '../src/auth/sessions.js';
import type { GatewayConfig, Environment } from '../src/config.js';
import type { App } from '../src/fastify.js';

const url = process.env['TEST_DATABASE_URL'];
const identityUrl = process.env['TEST_IDENTITY_DATABASE_URL'];

const sink = new Writable({
  write(_c, _e, cb) {
    cb();
  },
});

const dbConfig = {
  url: url!,
  identityUrl,
  maxConnections: 6,
  identityMaxConnections: 2,
  idleTimeoutMillis: 5_000,
  connectionTimeoutMillis: 5_000,
  statementTimeoutMillis: 10_000,
  applicationName: 'astra-test',
};

function makeApp(db: DbHandle, tokens: JwtTokens, env: Environment = 'test'): App {
  const config: GatewayConfig = {
    env,
    port: 0,
    host: '127.0.0.1',
    logLevel: 'silent',
    redisUrl: undefined,
    version: '0.1.0',
    db: dbConfig,
  };
  return buildApp({
    config,
    db,
    redis: null,
    rateLimiter: new MemoryRateLimiter(),
    logger: createLogger({ service: 'test', level: 'silent' }, sink),
    tokens,
  });
}

describe.skipIf(!url)('authentication', () => {
  let db: DbHandle;
  let app: App;
  let tokens: JwtTokens;

  const signUp = async (email = `u-${uuidv7()}@example.com`): Promise<TokenResponse> => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/auth/dev/token',
      payload: { email, display_name: 'Test User' },
    });
    expect(res.statusCode).toBe(200);
    return res.json<TokenResponse>();
  };

  beforeAll(async () => {
    db = createDb(dbConfig);
    tokens = new JwtTokens({
      issuer: 'https://auth.astra.test',
      keys: await loadSigningKeys({ keyId: 'test-1' }),
    });
  });

  // 認証経路には 10 req/分/IP の制限が掛かっている（実装仕様 §4.5）。
  // テストごとに新しいアプリ（= 新しいレート制限の状態）を立てる。
  // 制限そのものは専用のテストで確認する。
  beforeEach(async () => {
    app = makeApp(db, tokens);
    await app.ready();
  });

  afterEach(async () => {
    await app?.close();
  });

  afterAll(async () => {
    await db?.close();
  });

  describe('development token issuance', () => {
    it('provisions a tenant, user, device and session', async () => {
      const issued = await signUp();
      expect(issued.token_type).toBe('Bearer');
      expect(issued.expires_in).toBe(15 * 60);
      for (const t of [issued.access_token, issued.refresh_token, issued.device_token]) {
        expect(t.length).toBeGreaterThan(20);
      }
    });

    it('reuses the tenant when the same person signs in again', async () => {
      const email = `u-${uuidv7()}@example.com`;
      const first = await signUp(email);
      const second = await signUp(email);

      const me1 = await app.inject({
        method: 'GET',
        url: '/v1/me',
        headers: { authorization: `Bearer ${first.access_token}` },
      });
      const me2 = await app.inject({
        method: 'GET',
        url: '/v1/me',
        headers: { authorization: `Bearer ${second.access_token}` },
      });
      const a = me1.json<MeResponse>();
      const b = me2.json<MeResponse>();
      expect(b.tenant.id).toBe(a.tenant.id);
      expect(b.user.id).toBe(a.user.id);
      // 端末は都度別物
      expect(b.device.id).not.toBe(a.device.id);
    });

    it('rate limits the auth routes per IP', async () => {
      const fresh = makeApp(db, tokens);
      await fresh.ready();
      try {
        const hit = () =>
          fresh.inject({
            method: 'POST',
            url: '/v1/auth/refresh',
            payload: { refresh_token: 'v1.x.y.z' },
          });
        const codes: number[] = [];
        for (let i = 0; i < 12; i += 1) codes.push((await hit()).statusCode);
        // 10 回までは通り（トークンが不正なので 4xx）、それ以降が 429
        expect(codes.slice(0, 10).some((c) => c === 429)).toBe(false);
        expect(codes.slice(10).every((c) => c === 429)).toBe(true);
      } finally {
        await fresh.close();
      }
    });

    it('is not registered outside development', async () => {
      const prod = makeApp(db, tokens, 'production');
      await prod.ready();
      try {
        const res = await prod.inject({
          method: 'POST',
          url: '/v1/auth/dev/token',
          payload: { email: 'x@example.com' },
        });
        expect(res.statusCode).toBe(404);
      } finally {
        await prod.close();
      }
    });
  });

  describe('access tokens', () => {
    it('refuses a request with no token', async () => {
      const res = await app.inject({ method: 'GET', url: '/v1/me' });
      expect(res.statusCode).toBe(401);
      expect(res.json<ApiError>().error.code).toBe('auth.missing_token');
    });

    it('refuses a garbage token', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/v1/me',
        headers: { authorization: 'Bearer not-a-jwt' },
      });
      expect(res.statusCode).toBe(401);
      expect(res.json<ApiError>().error.code).toBe('auth.invalid_token');
    });

    it('distinguishes an expired token so the client knows to refresh', async () => {
      const expired = await tokens.issueAccessToken(
        { userId: uuidv7(), tenantId: uuidv7(), deviceId: uuidv7(), scopes: [] },
        new Date(Date.now() - 3_600_000),
      );
      const res = await app.inject({
        method: 'GET',
        url: '/v1/me',
        headers: { authorization: `Bearer ${expired}` },
      });
      expect(res.statusCode).toBe(401);
      expect(res.json<ApiError>().error.code).toBe('auth.expired_token');
    });

    it('refuses a device token on the API audience', async () => {
      // host bridge のトークンで REST を叩けてはいけない（実装仕様 §10.1）
      const issued = await signUp();
      const res = await app.inject({
        method: 'GET',
        url: '/v1/me',
        headers: { authorization: `Bearer ${issued.device_token}` },
      });
      expect(res.statusCode).toBe(401);
      expect(res.json<ApiError>().error.code).toBe('auth.invalid_token');
    });

    it('refuses a token signed by a different key', async () => {
      const other = new JwtTokens({
        issuer: 'https://auth.astra.test',
        keys: await loadSigningKeys({ keyId: 'other' }),
      });
      const forged = await other.issueAccessToken({
        userId: uuidv7(),
        tenantId: uuidv7(),
        deviceId: uuidv7(),
        scopes: [],
      });
      const res = await app.inject({
        method: 'GET',
        url: '/v1/me',
        headers: { authorization: `Bearer ${forged}` },
      });
      expect(res.statusCode).toBe(401);
    });
  });

  describe('GET /v1/me', () => {
    it('returns the principal behind the token', async () => {
      const issued = await signUp();
      const res = await app.inject({
        method: 'GET',
        url: '/v1/me',
        headers: { authorization: `Bearer ${issued.access_token}` },
      });
      expect(res.statusCode).toBe(200);
      const me = res.json<MeResponse>();
      expect(me.role).toBe('owner');
      expect(me.tenant.kind).toBe('personal');
      expect(me.tenant.compliance_profile).toBe('GENERAL');
      expect(me.device.platform).toBe('macos');
    });
  });

  describe('refresh rotation', () => {
    it('issues a new pair and invalidates the old refresh token', async () => {
      const first = await signUp();
      const res = await app.inject({
        method: 'POST',
        url: '/v1/auth/refresh',
        payload: { refresh_token: first.refresh_token },
      });
      expect(res.statusCode).toBe(200);
      const second = res.json<TokenResponse>();
      expect(second.refresh_token).not.toBe(first.refresh_token);

      const withNew = await app.inject({
        method: 'GET',
        url: '/v1/me',
        headers: { authorization: `Bearer ${second.access_token}` },
      });
      expect(withNew.statusCode).toBe(200);
    });

    it.each([
      [
        'a forged tenant segment',
        (t: string) => [t.split('.')[0], uuidv7(), ...t.split('.').slice(2)].join('.'),
      ],
      [
        'a forged session segment',
        (t: string) => {
          const p = t.split('.');
          p[2] = uuidv7();
          return p.join('.');
        },
      ],
      [
        'a forged secret',
        (t: string) => {
          const p = t.split('.');
          p[3] = 'x'.repeat(43);
          return p.join('.');
        },
      ],
      [
        'a wrong version prefix',
        (t: string) => {
          const p = t.split('.');
          p[0] = 'v9';
          return p.join('.');
        },
      ],
    ])('refuses %s', async (_label, tamper) => {
      const issued = await signUp();
      const res = await app.inject({
        method: 'POST',
        url: '/v1/auth/refresh',
        payload: { refresh_token: tamper(issued.refresh_token) },
      });
      expect(res.statusCode).toBe(401);
      expect(res.json<ApiError>().error.code).toBe('auth.invalid_token');
    });
  });

  describe('reuse detection', () => {
    it('revokes every session on the device and records an audit event', async () => {
      const first = await signUp();
      const rotated = await app.inject({
        method: 'POST',
        url: '/v1/auth/refresh',
        payload: { refresh_token: first.refresh_token },
      });
      expect(rotated.statusCode).toBe(200);
      const second = rotated.json<TokenResponse>();

      // 盗まれた古いトークンが再提示された
      const replay = await app.inject({
        method: 'POST',
        url: '/v1/auth/refresh',
        payload: { refresh_token: first.refresh_token },
      });
      expect(replay.statusCode).toBe(401);
      expect(replay.json<ApiError>().error.code).toBe('auth.refresh_reuse_detected');

      // 正規のセッションも道連れにする（どちらが本物か区別できないため）
      const afterReuse = await app.inject({
        method: 'POST',
        url: '/v1/auth/refresh',
        payload: { refresh_token: second.refresh_token },
      });
      expect(afterReuse.statusCode).toBe(401);

      const me = await app.inject({
        method: 'GET',
        url: '/v1/me',
        headers: { authorization: `Bearer ${first.access_token}` },
      });
      const tenantId = uuidvFromMe(me.json<MeResponse>());
      const deviceId = me.json<MeResponse>().device.id;

      const active = await withTenant(db, tenantId, (tx) =>
        countActiveSessions(tx, tenantId, deviceId),
      );
      expect(active).toBe(0);

      const chain = await withTenant(db, tenantId, (tx) => readAuditChain(tx, tenantId));
      expect(chain.map((r) => r.action)).toContain('session.reuse_detected');
      expect(await verifyAuditChain(chain)).toEqual([]);
    });
  });

  describe('logout', () => {
    it('revokes the session and treats a later refresh as reuse', async () => {
      const issued = await signUp();
      const out = await app.inject({
        method: 'POST',
        url: '/v1/auth/logout',
        payload: { refresh_token: issued.refresh_token },
      });
      expect(out.statusCode).toBe(204);

      const after = await app.inject({
        method: 'POST',
        url: '/v1/auth/refresh',
        payload: { refresh_token: issued.refresh_token },
      });
      expect(after.statusCode).toBe(401);
      expect(after.json<ApiError>().error.code).toBe('auth.refresh_reuse_detected');
    });
  });

  describe('audit trail', () => {
    it('records session creation and rotation on an intact chain', async () => {
      const issued = await signUp();
      await app.inject({
        method: 'POST',
        url: '/v1/auth/refresh',
        payload: { refresh_token: issued.refresh_token },
      });
      const me = await app.inject({
        method: 'GET',
        url: '/v1/me',
        headers: { authorization: `Bearer ${issued.access_token}` },
      });
      const tenantId = uuidvFromMe(me.json<MeResponse>());

      const chain = await withTenant(db, tenantId, (tx) => readAuditChain(tx, tenantId));
      expect(chain.map((r) => r.action)).toEqual(['session.created', 'session.rotated']);
      expect(await verifyAuditChain(chain)).toEqual([]);
    });
  });
});

function uuidvFromMe(me: MeResponse): string {
  return me.tenant.id;
}
