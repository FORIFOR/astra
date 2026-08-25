/**
 * ローカルファイルシステム実装。開発と Phase 0 用。
 * 本番は GCS アダプタ（Phase 2）。
 */
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Readable } from 'node:stream';
import { AstraError } from '@astra/contracts';
import type { ObjectHead, ObjectStore, PutResult } from './types.js';

async function toBuffer(body: Readable | Buffer): Promise<Buffer> {
  if (Buffer.isBuffer(body)) return body;
  const chunks: Buffer[] = [];
  for await (const chunk of body) chunks.push(Buffer.from(chunk as Buffer));
  return Buffer.concat(chunks);
}

export class FsObjectStore implements ObjectStore {
  readonly #root: string;
  readonly #contentTypes = new Map<string, string>();

  constructor(root: string) {
    this.#root = path.resolve(root);
  }

  #pathFor(key: string): string {
    // key はサーバが組み立てるが、外から来た値が紛れ込んでも root の外へ出さない
    const resolved = path.resolve(this.#root, key);
    if (resolved !== this.#root && !resolved.startsWith(this.#root + path.sep)) {
      throw new AstraError('common.validation_failed', `object key escapes the store root: ${key}`);
    }
    return resolved;
  }

  async put(
    key: string,
    body: Readable | Buffer,
    opts: { contentType: string },
  ): Promise<PutResult> {
    const buffer = await toBuffer(body);
    const target = this.#pathFor(key);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, buffer);
    this.#contentTypes.set(key, opts.contentType);
    return {
      size: buffer.byteLength,
      sha256: createHash('sha256').update(buffer).digest('hex'),
    };
  }

  async get(key: string): Promise<Readable> {
    const target = this.#pathFor(key);
    if (!(await this.head(key))) {
      throw new AstraError('artifact.not_found', `no object at ${key}`);
    }
    return createReadStream(target);
  }

  async head(key: string): Promise<ObjectHead | null> {
    try {
      const info = await stat(this.#pathFor(key));
      return {
        size: info.size,
        contentType: this.#contentTypes.get(key) ?? 'application/octet-stream',
      };
    } catch {
      return null;
    }
  }

  async signedReadUrl(key: string): Promise<string> {
    // 開発ではローカル配信でしかないので、署名は Phase 2 の GCS アダプタで実装する
    return `file://${this.#pathFor(key)}`;
  }

  async delete(key: string): Promise<void> {
    await rm(this.#pathFor(key), { force: true });
    this.#contentTypes.delete(key);
  }
}
