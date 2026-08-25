/**
 * プロセス内レート制限。開発とテスト専用。
 *
 * インスタンスをまたいで共有されないので、本番では使わない
 * （Cloud Run のように水平にスケールする環境では実質無制限になる）。
 */
import type { RateLimiter, RateLimitVerdict } from './types.js';

export class MemoryRateLimiter implements RateLimiter {
  readonly #hits = new Map<string, number[]>();

  async consume(
    key: string,
    limit: number,
    windowMs: number,
    now: number = Date.now(),
  ): Promise<RateLimitVerdict> {
    const cutoff = now - windowMs;
    const recent = (this.#hits.get(key) ?? []).filter((t) => t > cutoff);

    if (recent.length >= limit) {
      this.#hits.set(key, recent);
      const oldest = recent[0]!;
      return {
        allowed: false,
        limit,
        remaining: 0,
        resetAfterMs: Math.max(1, oldest + windowMs - now),
      };
    }

    recent.push(now);
    this.#hits.set(key, recent);
    return {
      allowed: true,
      limit,
      remaining: limit - recent.length,
      resetAfterMs: windowMs,
    };
  }

  async close(): Promise<void> {
    this.#hits.clear();
  }
}
