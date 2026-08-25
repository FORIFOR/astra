/**
 * HTTP 基盤の結合テスト。
 *   ./infra/db/with-test-db.sh pnpm --filter @astra/service-api-gateway test
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ApiError, AstraError, HEADER_REQUEST_ID } from '@astra/contracts';
import { createDb, type DbHandle } from '@astra/db';
import { createLogger } from '@astra/telemetry';
import { Writable } from 'node:stream';
import { buildApp } from '../src/app.js';
import { MemoryRateLimiter } from '../src/rate-limit/memory.js';
import type { GatewayConfig } from '../src/config.js';
import type { App } from '../src/fastify.js';

const url = process.env['TEST_DATABASE_URL'];

const sink = new Writable({
  write(_c, _e, cb) {
    cb();
  },
});

function makeApp(db: DbHandle): App {
  const config: GatewayConfig = {
    env: 'test',
    port: 0,
    host: '127.0.0.1',
    logLevel: 'silent',
    redisUrl: undefined,
    version: '0.1.0',
    db: {
      url: url!,
      maxConnections: 2,
      identityMaxConnections: 1,
      idleTimeoutMillis: 5_000,
      connectionTimeoutMillis: 5_000,
      statementTimeoutMillis: 10_000,
      applicationName: 'astra-test',
    },
  };
  return buildApp({
    config,
    db,
    redis: null,
    rateLimiter: new MemoryRateLimiter(),
    logger: createLogger({ service: 'test', level: 'silent' }, sink),
  });
}

describe.skipIf(!url)('api-gateway http foundation', () => {
  let db: DbHandle;
  let app: App;

  beforeAll(async () => {
    db = createDb({
      url: url!,
      maxConnections: 2,
      identityMaxConnections: 1,
      idleTimeoutMillis: 5_000,
      connectionTimeoutMillis: 5_000,
      statementTimeoutMillis: 10_000,
      applicationName: 'astra-test',
    });
    app = makeApp(db);

    app.get('/__test/boom', { config: { rateLimit: false } }, async () => {
      throw new Error('secret connection string hunter2');
    });
    app.get('/__test/known', { config: { rateLimit: false } }, async () => {
      throw new AstraError('task.not_found', 'no such task');
    });
    app.get(
      '/__test/limited',
      { config: { rateLimit: { limit: 2, windowMs: 60_000, by: 'ip', bucket: 'test' } } },
      async () => ({ ok: true }),
    );
    await app.ready();
  });

  afterAll(async () => {
    await app?.close();
    await db?.close();
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
      const brokenDb = createDb({
        url: 'postgres://nobody@127.0.0.1:1/nothing?sslmode=disable',
        maxConnections: 1,
        identityMaxConnections: 1,
        idleTimeoutMillis: 500,
        connectionTimeoutMillis: 300,
        statementTimeoutMillis: 500,
        applicationName: 'astra-test-broken',
      });
      const broken = makeApp(brokenDb);
      await broken.ready();
      try {
        const res = await broken.inject({ method: 'GET', url: '/readyz' });
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
