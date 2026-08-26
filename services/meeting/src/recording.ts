/**
 * 録音の置き場。Phase 3 実装仕様 §3。
 *
 * **STT より先に録音を残す。**正本 §11.2 の final pass は録音があって初めて
 * 成立するし、UI/UX §16 の degraded 文言（「録音は継続中」）も
 * 録音が STT から独立していなければ嘘になる。
 *
 * 追記のみ。会議中に読み返さない。
 */
import { createWriteStream } from 'node:fs';
import { mkdir, readFile, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import type { WriteStream } from 'node:fs';

export interface RecordingStore {
  append(meetingId: string, frame: Uint8Array): Promise<void>;
  /** 書き込みを閉じて全体を返す。閉じたあとの append は受け付けない。 */
  seal(meetingId: string): Promise<Uint8Array>;
  sizeOf(meetingId: string): Promise<number>;
  discard(meetingId: string): Promise<void>;
}

export class FsRecordingStore implements RecordingStore {
  readonly #root: string;
  readonly #open = new Map<string, WriteStream>();

  constructor(root: string) {
    this.#root = root;
  }

  async append(meetingId: string, frame: Uint8Array): Promise<void> {
    const stream = await this.#streamFor(meetingId);
    await new Promise<void>((resolve, reject) => {
      stream.write(frame, (err) => (err ? reject(err) : resolve()));
    });
  }

  async seal(meetingId: string): Promise<Uint8Array> {
    const stream = this.#open.get(meetingId);
    if (stream) {
      await new Promise<void>((resolve) => stream.end(resolve));
      this.#open.delete(meetingId);
    }
    try {
      return await readFile(this.#pathFor(meetingId));
    } catch {
      // 一度も音が来ないまま終わった会議。空として扱う。
      return new Uint8Array(0);
    }
  }

  async sizeOf(meetingId: string): Promise<number> {
    try {
      return (await stat(this.#pathFor(meetingId))).size;
    } catch {
      return 0;
    }
  }

  async discard(meetingId: string): Promise<void> {
    const stream = this.#open.get(meetingId);
    if (stream) {
      await new Promise<void>((resolve) => stream.end(resolve));
      this.#open.delete(meetingId);
    }
    await rm(this.#pathFor(meetingId), { force: true });
  }

  #pathFor(meetingId: string): string {
    // meetingId は uuid なので、そのままファイル名にしてよい
    return path.join(this.#root, `${meetingId}.pcm`);
  }

  async #streamFor(meetingId: string): Promise<WriteStream> {
    const existing = this.#open.get(meetingId);
    if (existing) return existing;
    await mkdir(this.#root, { recursive: true });
    const stream = createWriteStream(this.#pathFor(meetingId), { flags: 'a' });
    this.#open.set(meetingId, stream);
    return stream;
  }
}

/** テスト用。落ちない・消えない。 */
export class MemoryRecordingStore implements RecordingStore {
  readonly #chunks = new Map<string, Uint8Array[]>();

  async append(meetingId: string, frame: Uint8Array): Promise<void> {
    const list = this.#chunks.get(meetingId) ?? [];
    list.push(frame);
    this.#chunks.set(meetingId, list);
  }

  async seal(meetingId: string): Promise<Uint8Array> {
    const list = this.#chunks.get(meetingId) ?? [];
    const total = list.reduce((n, c) => n + c.byteLength, 0);
    const out = new Uint8Array(total);
    let at = 0;
    for (const chunk of list) {
      out.set(chunk, at);
      at += chunk.byteLength;
    }
    return out;
  }

  async sizeOf(meetingId: string): Promise<number> {
    return (this.#chunks.get(meetingId) ?? []).reduce((n, c) => n + c.byteLength, 0);
  }

  async discard(meetingId: string): Promise<void> {
    this.#chunks.delete(meetingId);
  }
}
