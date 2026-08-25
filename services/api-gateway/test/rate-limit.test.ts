import { afterAll, describe, expect, it } from 'vitest';
import { Redis } from 'ioredis';
import { uuidv7 } from '@astra/contracts';
import { MemoryRateLimiter } from '../src/rate-limit/memory.js';
import { RedisRateLimiter } from '../src/rate-limit/redis.js';
import { normalizeRequestId } from '../src/plugins/request-id.js';
import type { RateLimiter } from '../src/rate-limit/types.js';

function contract(name: string, make: () => RateLimiter, cleanup?: () => Promise<void>) {
  describe(name, () => {
    afterAll(async () => {
      await cleanup?.();
    });

    it('allows up to the limit and then refuses', async () => {
      const rl = make();
      const key = uuidv7();
      const now = 1_700_000_000_000;
      for (let i = 0; i < 3; i += 1) {
        const v = await rl.consume(key, 3, 1000, now);
        expect(v.allowed).toBe(true);
        expect(v.remaining).toBe(2 - i);
      }
      const denied = await rl.consume(key, 3, 1000, now);
      expect(denied.allowed).toBe(false);
      expect(denied.remaining).toBe(0);
      expect(denied.resetAfterMs).toBeGreaterThan(0);
      expect(denied.resetAfterMs).toBeLessThanOrEqual(1000);
    });

    it('does not let a refused request push the window further out', async () => {
      // 拒否がさらに窓を埋めると、攻撃者が叩き続ける限り永久に開かなくなる
      const rl = make();
      const key = uuidv7();
      const now = 1_700_000_000_000;
      await rl.consume(key, 1, 1000, now);
      for (let i = 0; i < 5; i += 1) await rl.consume(key, 1, 1000, now + i);
      const afterWindow = await rl.consume(key, 1, 1000, now + 1001);
      expect(afterWindow.allowed).toBe(true);
    });

    it('slides rather than resetting on a fixed boundary', async () => {
      const rl = make();
      const key = uuidv7();
      const t0 = 1_700_000_000_000;
      await rl.consume(key, 2, 1000, t0);
      await rl.consume(key, 2, 1000, t0 + 900);
      expect((await rl.consume(key, 2, 1000, t0 + 950)).allowed).toBe(false);
      // t0 の 1 件だけが窓から出る
      expect((await rl.consume(key, 2, 1000, t0 + 1001)).allowed).toBe(true);
      expect((await rl.consume(key, 2, 1000, t0 + 1002)).allowed).toBe(false);
    });

    it('keeps separate keys independent', async () => {
      const rl = make();
      const a = uuidv7();
      const b = uuidv7();
      const now = 1_700_000_000_000;
      await rl.consume(a, 1, 1000, now);
      expect((await rl.consume(a, 1, 1000, now)).allowed).toBe(false);
      expect((await rl.consume(b, 1, 1000, now)).allowed).toBe(true);
    });

    it('counts requests that land on the same millisecond separately', async () => {
      const rl = make();
      const key = uuidv7();
      const now = 1_700_000_000_000;
      const results = await Promise.all(
        Array.from({ length: 5 }, () => rl.consume(key, 3, 1000, now)),
      );
      expect(results.filter((r) => r.allowed)).toHaveLength(3);
    });
  });
}

contract('MemoryRateLimiter', () => new MemoryRateLimiter());

const redisUrl = process.env['TEST_REDIS_URL'];
if (redisUrl) {
  // 他プロジェクトのキーに触れないよう、実行ごとに固有の接頭辞を使い、最後に自分の分だけ消す
  const prefix = `astra:test:${uuidv7()}:`;
  const redis = new Redis(redisUrl);
  contract(
    'RedisRateLimiter',
    () => new RedisRateLimiter(redis, prefix),
    async () => {
      const keys = await redis.keys(`${prefix}*`);
      if (keys.length > 0) await redis.del(...keys);
      await redis.quit();
    },
  );
} else {
  describe.skip('RedisRateLimiter (set TEST_REDIS_URL to run)', () => {
    it('skipped', () => undefined);
  });
}

describe('normalizeRequestId', () => {
  it('keeps a well-formed inbound id', () => {
    expect(normalizeRequestId('req-abc-123')).toBe('req-abc-123');
  });

  it('replaces anything it cannot trust', () => {
    for (const bad of [
      '',
      'short',
      'x'.repeat(200),
      'has space',
      '<script>',
      42,
      undefined,
      null,
    ]) {
      const out = normalizeRequestId(bad);
      expect(out).not.toBe(bad);
      expect(out).toMatch(/^[0-9a-f-]{36}$/);
    }
  });
});
