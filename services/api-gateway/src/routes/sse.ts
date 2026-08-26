/**
 * SSE によるイベント配信。実装仕様 §7.3、ADR 0003。
 *
 * 設計の要:
 *   **DB を唯一の真実にする。** Redis の pub/sub は「早く起こす」だけに使い、
 *   配信の正しさを pub/sub の到達性に依存させない。取りこぼしても次の周回で
 *   DB から拾えるので、欠番なしの契約（§7.2）が pub/sub の品質に左右されない。
 *
 *   購読はリプレイの**前**に張る。逆順にすると、DB を読んでから購読するまでの
 *   隙間に発火したイベントを取り落とす。
 */
import type { Redis } from 'ioredis';
import {
  SSE_HEARTBEAT_FRAME,
  SSE_HEARTBEAT_INTERVAL_MS,
  toSseFrame,
  type EventEnvelope,
} from '@astra/contracts';
import { channelFor } from '@astra/service-task';

/** 終端イベント。これを送ったらサーバから閉じる。 */
const TERMINAL_TYPES = new Set([
  'task.completed',
  'task.failed',
  'task.cancelled',
  // 会議も終端を持つ。無いと終わった会議の購読が開いたままになる。
  'meeting.ended',
]);

export interface EventWaker {
  /** 新着があれば早く resolve する。無ければ `timeoutMs` 後に resolve。 */
  wait(timeoutMs: number): Promise<void>;
  close(): Promise<void>;
}

/** Redis が無い環境（開発・テスト）用。単純な間隔ポーリング。 */
export function pollingWaker(): EventWaker {
  let timer: NodeJS.Timeout | undefined;
  return {
    wait: (timeoutMs) =>
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, timeoutMs);
      }),
    async close() {
      if (timer) clearTimeout(timer);
    },
  };
}

/** Redis pub/sub で早く起こす。購読はこの関数を呼んだ時点で張られる。 */
export async function redisWaker(
  redis: Redis,
  streamKind: 'task' | 'conversation' | 'meeting',
  streamId: string,
): Promise<EventWaker> {
  const subscriber = redis.duplicate();
  let pending: (() => void) | null = null;

  subscriber.on('message', () => {
    pending?.();
    pending = null;
  });
  await subscriber.subscribe(channelFor(streamKind, streamId));

  return {
    wait: (timeoutMs) =>
      new Promise<void>((resolve) => {
        const timer = setTimeout(() => {
          pending = null;
          resolve();
        }, timeoutMs);
        pending = () => {
          clearTimeout(timer);
          resolve();
        };
      }),
    async close() {
      pending = null;
      await subscriber.quit();
    },
  };
}

export interface SseStreamOptions {
  readonly write: (chunk: string) => void;
  readonly isOpen: () => boolean;
  readonly fetchAfter: (sequence: number) => Promise<EventEnvelope[]>;
  readonly waker: EventWaker;
  readonly startAfter: number;
  readonly pollIntervalMs?: number;
  readonly heartbeatIntervalMs?: number;
  /** 終端イベントを送っていなくても、この時間で打ち切る。接続を無限に抱えないため。 */
  readonly maxDurationMs?: number;
  readonly now?: () => number;
}

/**
 * 開いた接続へイベントを流し続ける。終端イベントを送ったら戻る。
 * 戻り値は最後に送った sequence。
 */
export async function pumpEventStream(options: SseStreamOptions): Promise<number> {
  const pollInterval = options.pollIntervalMs ?? 250;
  const heartbeatInterval = options.heartbeatIntervalMs ?? SSE_HEARTBEAT_INTERVAL_MS;
  const maxDuration = options.maxDurationMs ?? 30 * 60_000;
  const now = options.now ?? (() => Date.now());

  const startedAt = now();
  let cursor = options.startAfter;
  let lastWrite = now();

  while (options.isOpen() && now() - startedAt < maxDuration) {
    const events = await options.fetchAfter(cursor);

    for (const event of events) {
      // 欠番があれば契約違反。黙って進めず、ここで止めてクライアントに再接続させる。
      if (event.sequence !== cursor + 1) return cursor;
      options.write(toSseFrame(event));
      cursor = event.sequence;
      lastWrite = now();
      if (TERMINAL_TYPES.has(event.type)) return cursor;
    }

    if (now() - lastWrite >= heartbeatInterval) {
      // LB のアイドル切断を避ける（実装仕様 §7.3）
      options.write(SSE_HEARTBEAT_FRAME);
      lastWrite = now();
    }

    await options.waker.wait(pollInterval);
  }

  return cursor;
}

/** `Last-Event-ID` を読む。信用できない値は 0（= 最初から）に倒す。 */
export function parseLastEventId(header: unknown): number {
  const raw = Array.isArray(header) ? header[0] : header;
  if (typeof raw !== 'string') return 0;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}
