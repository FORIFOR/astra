/** オブジェクトストレージ。実装仕様 §8.1。 */
import type { Readable } from 'node:stream';

export interface PutResult {
  readonly size: number;
  readonly sha256: string;
}

export interface ObjectHead {
  readonly size: number;
  readonly contentType: string;
}

export interface ObjectStore {
  put(key: string, body: Readable | Buffer, opts: { contentType: string }): Promise<PutResult>;
  get(key: string): Promise<Readable>;
  head(key: string): Promise<ObjectHead | null>;
  /**
   * 署名済み短期 URL。正本 §2.3「raw storage URL を外部へ出さない」を
   * Phase 2 で満たすために interface へ先に入れてある。
   */
  signedReadUrl(key: string, ttlSeconds: number): Promise<string>;
  delete(key: string): Promise<void>;
}
