/** レート制限。実装仕様 §4.5。 */

export interface RateLimitVerdict {
  readonly allowed: boolean;
  readonly limit: number;
  readonly remaining: number;
  /** 窓が空くまでのミリ秒。`Retry-After` の算出に使う。 */
  readonly resetAfterMs: number;
}

export interface RateLimiter {
  /**
   * スライディングウィンドウで 1 回分消費する。
   * 拒否された場合も消費しない（拒否がさらに窓を埋める挙動にしない）。
   */
  consume(key: string, limit: number, windowMs: number, now?: number): Promise<RateLimitVerdict>;
  close(): Promise<void>;
}
