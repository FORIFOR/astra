import { describe, expect, it, vi } from 'vitest';
import { uuidv7, type EventEnvelope } from '@astra/contracts';
import { parseLastEventId, pumpEventStream, pollingWaker } from '../src/routes/sse.js';

const streamId = uuidv7();
const tenantId = uuidv7();

const event = (sequence: number, type: string, payload: unknown = {}): EventEnvelope =>
  ({
    event_id: uuidv7(),
    type,
    timestamp: new Date().toISOString(),
    tenant_id: tenantId,
    stream_kind: 'task',
    stream_id: streamId,
    sequence,
    payload,
  }) as EventEnvelope;

const progress = (sequence: number) =>
  event(sequence, 'task.progress', {
    phase: 'thinking',
    step_index: 0,
    step_count: 1,
    message: 'x',
    detail: null,
    elapsed_ms: null,
    retrying: false,
  });

function collector() {
  const chunks: string[] = [];
  return { chunks, write: (c: string) => chunks.push(c) };
}

describe('pumpEventStream', () => {
  it('streams from the requested sequence and closes on a terminal event', async () => {
    const out = collector();
    const all = [
      progress(1),
      progress(2),
      event(3, 'task.completed', { result_artifact_id: null, duration_ms: 5 }),
    ];
    const last = await pumpEventStream({
      write: out.write,
      isOpen: () => true,
      fetchAfter: async (n) => all.filter((e) => e.sequence > n),
      waker: pollingWaker(),
      startAfter: 0,
      pollIntervalMs: 1,
    });

    expect(last).toBe(3);
    expect(out.chunks).toHaveLength(3);
    expect(out.chunks[0]!.startsWith('id: 1\n')).toBe(true);
    expect(out.chunks.at(-1)!).toContain('event: task.completed');
  });

  it('resumes after Last-Event-ID without repeating anything', async () => {
    const out = collector();
    const all = [
      progress(1),
      progress(2),
      progress(3),
      event(4, 'task.cancelled', { reason: 'x' }),
    ];
    await pumpEventStream({
      write: out.write,
      isOpen: () => true,
      fetchAfter: async (n) => all.filter((e) => e.sequence > n),
      waker: pollingWaker(),
      startAfter: 2,
      pollIntervalMs: 1,
    });

    const ids = out.chunks.map((c) => Number(/^id: (\d+)/.exec(c)![1]));
    expect(ids).toEqual([3, 4]);
  });

  it('stops instead of skipping when the stream has a gap', async () => {
    // 欠番なしは契約（§7.2）。黙って進めると取りこぼしに気づけない。
    const out = collector();
    const all = [progress(1), progress(3)];
    const last = await pumpEventStream({
      write: out.write,
      isOpen: () => true,
      fetchAfter: async (n) => all.filter((e) => e.sequence > n),
      waker: pollingWaker(),
      startAfter: 0,
      pollIntervalMs: 1,
    });
    expect(last).toBe(1);
    expect(out.chunks).toHaveLength(1);
  });

  it('sends a heartbeat when nothing happens for a while', async () => {
    const out = collector();
    let clock = 0;
    const waker = {
      wait: async () => {
        clock += 5_000;
      },
      close: async () => {},
    };
    await pumpEventStream({
      write: out.write,
      isOpen: () => clock < 40_000,
      fetchAfter: async () => [],
      waker,
      startAfter: 0,
      pollIntervalMs: 1,
      heartbeatIntervalMs: 15_000,
      now: () => clock,
    });
    expect(out.chunks.filter((c) => c === ': ping\n\n').length).toBeGreaterThanOrEqual(2);
  });

  it('gives up once the client is gone', async () => {
    const out = collector();
    let open = true;
    const fetchAfter = vi.fn(async () => {
      open = false;
      return [];
    });
    await pumpEventStream({
      write: out.write,
      isOpen: () => open,
      fetchAfter,
      waker: pollingWaker(),
      startAfter: 0,
      pollIntervalMs: 1,
    });
    expect(fetchAfter).toHaveBeenCalledTimes(1);
  });

  it('stops at the max duration even without a terminal event', async () => {
    const out = collector();
    let clock = 0;
    const waker = {
      wait: async () => {
        clock += 1_000;
      },
      close: async () => {},
    };
    await pumpEventStream({
      write: out.write,
      isOpen: () => true,
      fetchAfter: async () => [],
      waker,
      startAfter: 0,
      heartbeatIntervalMs: 10_000_000,
      maxDurationMs: 5_000,
      now: () => clock,
    });
    expect(clock).toBeLessThanOrEqual(6_000);
  });
});

describe('parseLastEventId', () => {
  it('accepts a non-negative integer', () => {
    expect(parseLastEventId('42')).toBe(42);
    expect(parseLastEventId('0')).toBe(0);
  });

  it('falls back to the start of the stream for anything it cannot trust', () => {
    for (const bad of ['', 'abc', '-1', undefined, null, {}, ['x']]) {
      expect(parseLastEventId(bad)).toBe(0);
    }
  });

  it('takes the first value when the header repeats', () => {
    expect(parseLastEventId(['7', '9'])).toBe(7);
  });
});
