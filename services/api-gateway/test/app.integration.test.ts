/**
 * HTTP 基盤の結合テスト。
 *   ./infra/db/with-test-db.sh pnpm --filter @astra/service-api-gateway test
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ApiError, AstraError, HEADER_REQUEST_ID } from '@astra/contracts';
import { createDb, type DbHandle } from '@astra/db';
import { makeTestApp, makeTokens, testDbConfig, type TestApp } from './support.js';
import type { JwtTokens } from '../src/auth/tokens.js';
import type { App } from '../src/fastify.js';

const url = process.env['TEST_DATABASE_URL'];

describe.skipIf(!url)('api-gateway http foundation', () => {
  let harness: TestApp;
  let app: App;
  let tokens: JwtTokens;

  beforeAll(async () => {
    tokens = await makeTokens();
    harness = await makeTestApp({
      dbConfig: testDbConfig(url!),
      tokens,
      configure(instance) {
        instance.get('/__test/boom', { config: { rateLimit: false, auth: false } }, async () => {
          throw new Error('secret connection string hunter2');
        });
        instance.get('/__test/known', { config: { rateLimit: false, auth: false } }, async () => {
          throw new AstraError('task.not_found', 'no such task');
        });
        instance.get(
          '/__test/limited',
          {
            config: {
              auth: false,
              rateLimit: { limit: 2, windowMs: 60_000, by: 'ip', bucket: 'test' },
            },
          },
          async () => ({ ok: true }),
        );
      },
    });
    app = harness.app;
  });

  afterAll(async () => {
    await harness?.close();
  });

  describe('health probes', () => {
    it('reports liveness without touching dependencies', async () => {
      const res = await app.inject({ method: 'GET', url: '/healthz' });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ status: 'ok', version: '0.1.0' });
    });

    it('reports readiness with per-dependency checks', async () => {
      const res = await app.inject({ method: 'GET', url: '/readyz' });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ status: 'ok', checks: { database: 'ok' } });
    });

    it('fails readiness when the database is unreachable', async () => {
      const brokenConfig = {
        ...testDbConfig('postgres://nobody@127.0.0.1:1/nothing?sslmode=disable'),
        connectionTimeoutMillis: 300,
      };
      const brokenDb = createDb(brokenConfig);
      const broken = await makeTestApp({ db: brokenDb, dbConfig: brokenConfig, tokens });
      try {
        const res = await broken.app.inject({ method: 'GET', url: '/readyz' });
        expect(res.statusCode).toBe(503);
        expect(res.json()).toMatchObject({ status: 'down', checks: { database: 'down' } });
      } finally {
        await broken.close();
        await brokenDb.close().catch(() => undefined);
      }
    });
  });

  describe('request id', () => {
    it('echoes a well-formed inbound id', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/healthz',
        headers: { [HEADER_REQUEST_ID]: 'client-supplied-id' },
      });
      expect(res.headers[HEADER_REQUEST_ID]).toBe('client-supplied-id');
    });

    it('replaces an untrusted inbound id', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/healthz',
        headers: { [HEADER_REQUEST_ID]: '<script>alert(1)</script>' },
      });
      expect(res.headers[HEADER_REQUEST_ID]).not.toContain('script');
      expect(res.headers[HEADER_REQUEST_ID]).toMatch(/^[0-9a-f-]{36}$/);
    });

    it('puts the same id in the error body', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/__test/known',
        headers: { [HEADER_REQUEST_ID]: 'correlate-me-123' },
      });
      expect(res.json<ApiError>().error.request_id).toBe('correlate-me-123');
      expect(res.headers[HEADER_REQUEST_ID]).toBe('correlate-me-123');
    });
  });

  describe('error contract', () => {
    it('returns the declared shape for an unknown route', async () => {
      const res = await app.inject({ method: 'GET', url: '/v1/nope' });
      expect(res.statusCode).toBe(404);
      const body = res.json<ApiError>();
      expect(ApiError.safeParse(body).success).toBe(true);
      expect(body.error.code).toBe('common.not_found');
    });

    it('maps a known error to its status', async () => {
      const res = await app.inject({ method: 'GET', url: '/__test/known' });
      expect(res.statusCode).toBe(404);
      expect(res.json<ApiError>().error.code).toBe('task.not_found');
    });

    it('hides internal exception details', async () => {
      const res = await app.inject({ method: 'GET', url: '/__test/boom' });
      expect(res.statusCode).toBe(500);
      expect(res.body).not.toContain('hunter2');
      expect(res.json<ApiError>().error.code).toBe('common.internal');
    });
  });

  describe('cross-origin access', () => {
    it('answers the preflight for an allowed origin', async () => {
      const allowed = await makeTestApp({
        dbConfig: testDbConfig(url!),
        tokens,
        allowedOrigins: ['http://localhost:1420'],
      });
      try {
        const res = await allowed.app.inject({
          method: 'OPTIONS',
          url: '/v1/tasks',
          headers: {
            origin: 'http://localhost:1420',
            'access-control-request-method': 'POST',
            'access-control-request-headers': 'authorization,idempotency-key',
          },
        });
        expect(res.statusCode).toBe(204);
        expect(res.headers['access-control-allow-origin']).toBe('http://localhost:1420');
        // SSE の再開に要るヘッダをクライアントが読めること
        expect(res.headers['access-control-allow-headers']).toContain('last-event-id');
        // uninstall は DELETE。明示しないと preflight に載らない。
        expect(res.headers['access-control-allow-methods']).toContain('DELETE');
        // onboarding の保存は PATCH。落ちると初期セットアップが毎回最初からになる。
        expect(res.headers['access-control-allow-methods']).toContain('PATCH');
      } finally {
        await allowed.close();
      }
    });

    it('refuses an origin that is not on the list', async () => {
      const allowed = await makeTestApp({
        dbConfig: testDbConfig(url!),
        tokens,
        allowedOrigins: ['http://localhost:1420'],
      });
      try {
        const res = await allowed.app.inject({
          method: 'GET',
          url: '/healthz',
          headers: { origin: 'https://evil.example.com' },
        });
        // ヘッダを返さないことで、ブラウザ側が読めなくなる
        expect(res.headers['access-control-allow-origin']).toBeUndefined();
      } finally {
        await allowed.close();
      }
    });

    it('allows nothing when no origin is configured', async () => {
      // `*` を既定にすると、認証済みの API が任意のサイトから叩ける
      const res = await app.inject({
        method: 'GET',
        url: '/healthz',
        headers: { origin: 'http://localhost:1420' },
      });
      expect(res.headers['access-control-allow-origin']).toBeUndefined();
    });
  });

  describe('rate limiting', () => {
    it('refuses past the limit with the error contract and Retry-After', async () => {
      const hit = () => app.inject({ method: 'GET', url: '/__test/limited' });
      expect((await hit()).statusCode).toBe(200);
      expect((await hit()).statusCode).toBe(200);

      const denied = await hit();
      expect(denied.statusCode).toBe(429);
      expect(denied.headers['retry-after']).toBeDefined();
      expect(denied.headers['x-ratelimit-remaining']).toBe('0');
      const body = denied.json<ApiError>();
      expect(ApiError.safeParse(body).success).toBe(true);
      expect(body.error.code).toBe('common.rate_limited');
    });

    it('never rate limits the health probes', async () => {
      for (let i = 0; i < 20; i += 1) {
        expect((await app.inject({ method: 'GET', url: '/healthz' })).statusCode).toBe(200);
      }
    });
  });
});
