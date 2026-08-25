/**
 * Redis によるスライディングウィンドウ。実装仕様 §4.5。
 *
 * sorted set に「その窓の中で消費した時刻」を積む。判定・掃除・追加を 1 本の
 * Lua スクリプトにまとめ、読み取りと書き込みの間に別プロセスが割り込めないようにする
 * （分割して発行すると上限を超えて通る競合が起きる）。
 */
import type { Redis } from 'ioredis';
import type { RateLimiter, RateLimitVerdict } from './types.js';

const SCRIPT = `
local key    = KEYS[1]
local now    = tonumber(ARGV[1])
local window = tonumber(ARGV[2])
local limit  = tonumber(ARGV[3])
local member = ARGV[4]

redis.call('ZREMRANGEBYSCORE', key, 0, now - window)
local used = redis.call('ZCARD', key)

if used >= limit then
  local oldest = redis.call('ZRANGE', key, 0, 0, 'WITHSCORES')
  local reset = window
  if oldest[2] then reset = math.max(1, (tonumber(oldest[2]) + window) - now) end
  return {0, 0, reset}
end

redis.call('ZADD', key, now, member)
redis.call('PEXPIRE', key, window)
return {1, limit - used - 1, window}
`;

export class RedisRateLimiter implements RateLimiter {
  readonly #redis: Redis;
  readonly #prefix: string;
  #counter = 0;

  constructor(redis: Redis, prefix = 'astra:rl:') {
    this.#redis = redis;
    this.#prefix = prefix;
  }

  async consume(
    key: string,
    limit: number,
    windowMs: number,
    now: number = Date.now(),
  ): Promise<RateLimitVerdict> {
    // 同一ミリ秒の複数リクエストが同じ member になると 1 件に潰れるため、
    // プロセス内カウンタで一意にする
    this.#counter = (this.#counter + 1) % Number.MAX_SAFE_INTEGER;
    const member = `${now}-${process.pid}-${this.#counter}`;

    const result = (await this.#redis.eval(
      SCRIPT,
      1,
      `${this.#prefix}${key}`,
      String(now),
      String(windowMs),
      String(limit),
      member,
    )) as [number, number, number];

    return {
      allowed: result[0] === 1,
      limit,
      remaining: result[1],
      resetAfterMs: result[2],
    };
  }

  async close(): Promise<void> {
    await this.#redis.quit();
  }
}
