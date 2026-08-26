/**
 * API クライアント。実装仕様 §3.7・§7.3・§11。
 */
import { describe, expect, it, vi } from 'vitest';
import { ApprovalId, AstraError, uuidv7, type EventEnvelope } from '@astra/contracts';
import { AstraClient } from '../src/client.js';
import { HttpClient } from '../src/http.js';
import { parseSseFrames, streamTaskEvents } from '../src/sse.js';

const now = new Date().toISOString();

const task = (over: Record<string, unknown> = {}) => ({
  id: uuidv7(),
  tenant_id: uuidv7(),
  created_by: uuidv7(),
  conversation_id: null,
  kind: 'echo',
  title: null,
  status: 'RUNNING',
  input: {},
  result_artifact_id: null,
  error: null,
  created_at: now,
  started_at: now,
  completed_at: null,
  updated_at: now,
  ...over,
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function makeClient(fetchImpl: typeof globalThis.fetch, token: string | null = 'tok') {
  return new AstraClient({
    baseUrl: 'https://astra.test/',
    accessToken: () => token,
    fetch: fetchImpl,
  });
}

describe('requests', () => {
  it('sends the bearer token and a request id', async () => {
    const seen: Request[] = [];
    const client = makeClient(async (input, init) => {
      seen.push(new Request(input as string, init));
      return jsonResponse(task());
    });
    await client.getTask('t1');

    const headers = seen[0]!.headers;
    expect(headers.get('authorization')).toBe('Bearer tok');
    expect(headers.get('x-request-id')).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('omits authorization when there is no token', async () => {
    const seen: Request[] = [];
    const client = makeClient(async (input, init) => {
      seen.push(new Request(input as string, init));
      return jsonResponse(task());
    }, null);
    await client.getTask('t1');
    expect(seen[0]!.headers.has('authorization')).toBe(false);
  });

  it('passes the idempotency key the caller chose', async () => {
    // 再送で同じ鍵を使えることが冪等性の意味。毎回作り直しては意味がない。
    const seen: Request[] = [];
    const client = makeClient(async (input, init) => {
      seen.push(new Request(input as string, init));
      return jsonResponse(task({ status: 'PENDING' }));
    });
    await client.createTask({ kind: 'echo', input: {} }, 'my-key');
    expect(seen[0]!.headers.get('idempotency-key')).toBe('my-key');
  });

  it('builds query strings without empty parameters', async () => {
    const urls: string[] = [];
    const client = makeClient(async (input) => {
      urls.push(String(input));
      return jsonResponse({ items: [], next_cursor: null });
    });
    await client.listTasks({ limit: 5 });
    expect(urls[0]).toBe('https://astra.test/v1/tasks?limit=5');
  });

  it('handles a 204 without trying to parse a body', async () => {
    const client = makeClient(async () => new Response(null, { status: 204 }));
    await expect(
      client.decideApproval('t1', {
        approval_id: ApprovalId.parse(uuidv7()),
        decision: 'APPROVED',
      }),
    ).resolves.toBeUndefined();
  });
});

describe('errors (§3.7)', () => {
  it('surfaces the server code and message', async () => {
    const client = makeClient(async () =>
      jsonResponse(
        { error: { code: 'task.not_found', message: 'no task', request_id: 'r1' } },
        404,
      ),
    );
    await expect(client.getTask('missing')).rejects.toMatchObject({
      code: 'task.not_found',
      httpStatus: 404,
    });
  });

  it('does not invent a code from a body that is not the contract', async () => {
    // proxy の HTML や 502 ページを code として扱うと、分岐が嘘の code で動き出す
    const client = makeClient(
      async () => new Response('<html>bad gateway</html>', { status: 502 }),
    );
    const error = await client.getTask('t1').catch((e: unknown) => e as AstraError);
    expect(error).toBeInstanceOf(AstraError);
    expect((error as AstraError).code).toBe('common.unavailable');
    expect((error as AstraError).retryable).toBe(true);
  });

  it('marks rate limiting as retryable and validation as not', async () => {
    const limited = makeClient(async () =>
      jsonResponse(
        { error: { code: 'common.rate_limited', message: 'slow down', request_id: 'r' } },
        429,
      ),
    );
    await expect(limited.getTask('t')).rejects.toMatchObject({ retryable: true });

    const invalid = makeClient(async () =>
      jsonResponse(
        { error: { code: 'common.validation_failed', message: 'bad', request_id: 'r' } },
        400,
      ),
    );
    await expect(invalid.getTask('t')).rejects.toMatchObject({ retryable: false });
  });

  it('retries once after a recoverable 401 and then gives up', async () => {
    const calls: string[] = [];
    let refreshed = false;
    const client = new AstraClient({
      baseUrl: 'https://astra.test',
      accessToken: () => (refreshed ? 'new' : 'old'),
      fetch: async (input, init) => {
        calls.push(new Request(input as string, init).headers.get('authorization') ?? '');
        return refreshed
          ? jsonResponse(task())
          : jsonResponse(
              { error: { code: 'auth.expired_token', message: 'x', request_id: 'r' } },
              401,
            );
      },
      onUnauthorized: async () => {
        refreshed = true;
        return true;
      },
    });

    await client.getTask('t1');
    expect(calls).toEqual(['Bearer old', 'Bearer new']);
  });

  it('does not loop when recovery keeps failing', async () => {
    let attempts = 0;
    const client = new AstraClient({
      baseUrl: 'https://astra.test',
      accessToken: () => 'tok',
      fetch: async () => {
        attempts += 1;
        return jsonResponse(
          { error: { code: 'auth.invalid_token', message: 'x', request_id: 'r' } },
          401,
        );
      },
      onUnauthorized: async () => true,
    });
    await expect(client.getTask('t1')).rejects.toMatchObject({ code: 'auth.invalid_token' });
    expect(attempts).toBe(2);
  });
});

describe('response validation', () => {
  it('refuses a task that does not match the contract', async () => {
    const client = makeClient(async () => jsonResponse({ id: 'not-a-uuid' }));
    await expect(client.getTask('t1')).rejects.toThrow();
  });

  it('derives the dock state when the server omits it', async () => {
    const client = makeClient(async () => jsonResponse(task({ status: 'WAITING_APPROVAL' })));
    const view = await client.getTask('t1');
    expect(view.dockState).toBe('WAITING_APPROVAL');
  });

  it('prefers the dock state the server computed', async () => {
    const client = makeClient(async () =>
      jsonResponse({ ...task({ status: 'RUNNING' }), dock_state: 'RESULT' }),
    );
    expect((await client.getTask('t1')).dockState).toBe('RESULT');
  });
});

describe('artifact content', () => {
  it('never exposes a raw storage url', () => {
    const http = new HttpClient({ baseUrl: 'https://astra.test', accessToken: () => null });
    expect(http.urlFor('/v1/artifacts/a1/content')).toBe(
      'https://astra.test/v1/artifacts/a1/content',
    );
  });
});

// ---------------------------------------------------------------- streaming

const envelope = (sequence: number, type: string, payload: unknown): EventEnvelope =>
  ({
    event_id: uuidv7(),
    type,
    timestamp: now,
    tenant_id: uuidv7(),
    stream_kind: 'task',
    stream_id: uuidv7(),
    sequence,
    payload,
  }) as EventEnvelope;

const progress = (sequence: number) =>
  envelope(sequence, 'task.progress', {
    phase: 'thinking',
    step_index: 0,
    step_count: 1,
    message: 'x',
    detail: null,
    elapsed_ms: null,
    retrying: false,
  });

const completed = (sequence: number) =>
  envelope(sequence, 'task.completed', { result_artifact_id: null, duration_ms: 1 });

function sseBody(events: EventEnvelope[], chunkSize = 1): Response {
  const frames = events.map(
    (e) => `id: ${e.sequence}\nevent: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`,
  );
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (let i = 0; i < frames.length; i += chunkSize) {
        controller.enqueue(encoder.encode(frames.slice(i, i + chunkSize).join('')));
      }
      controller.close();
    },
  });
  return new Response(stream, { status: 200, headers: { 'content-type': 'text/event-stream' } });
}

function httpWith(fetchImpl: typeof globalThis.fetch): HttpClient {
  return new HttpClient({
    baseUrl: 'https://astra.test',
    accessToken: () => 'tok',
    fetch: fetchImpl,
  });
}

describe('parseSseFrames', () => {
  it('reads id, event and data and skips heartbeats', () => {
    const frames = parseSseFrames(': ping\n\nid: 1\nevent: task.progress\ndata: {"a":1}\n\n');
    expect(frames).toEqual([{ id: 1, event: 'task.progress', data: '{"a":1}' }]);
  });
});

describe('streamTaskEvents (§7.3)', () => {
  it('delivers every event in order and stops at the terminal one', async () => {
    const received: EventEnvelope[] = [];
    const http = httpWith(async () => sseBody([progress(1), progress(2), completed(3)]));

    const last = await streamTaskEvents(http, 't1', { onEvent: (e) => received.push(e) });
    expect(last).toBe(3);
    expect(received.map((e) => e.sequence)).toEqual([1, 2, 3]);
  });

  it('reassembles frames split across chunks', async () => {
    const received: EventEnvelope[] = [];
    const encoder = new TextEncoder();
    const whole = [progress(1), completed(2)]
      .map((e) => `id: ${e.sequence}\nevent: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`)
      .join('');
    const http = httpWith(
      async () =>
        new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              // 途中で無理やり切る
              const cut = Math.floor(whole.length / 3);
              controller.enqueue(encoder.encode(whole.slice(0, cut)));
              controller.enqueue(encoder.encode(whole.slice(cut)));
              controller.close();
            },
          }),
          { status: 200 },
        ),
    );

    await streamTaskEvents(http, 't1', { onEvent: (e) => received.push(e) });
    expect(received.map((e) => e.sequence)).toEqual([1, 2]);
  });

  it('resumes from Last-Event-ID after a drop, without duplicating', async () => {
    const received: EventEnvelope[] = [];
    const lastEventIds: (string | null)[] = [];
    let call = 0;
    const http = httpWith(async (input, init) => {
      lastEventIds.push(new Request(input as string, init).headers.get('last-event-id'));
      call += 1;
      // 1 回目は途中で切れる
      return call === 1
        ? sseBody([progress(1), progress(2)])
        : sseBody([progress(3), completed(4)]);
    });

    const last = await streamTaskEvents(http, 't1', {
      onEvent: (e) => received.push(e),
      backoffMs: () => 0,
    });

    expect(last).toBe(4);
    expect(received.map((e) => e.sequence)).toEqual([1, 2, 3, 4]);
    expect(lastEventIds).toEqual([null, '2']);
  });

  it('drops events it has already seen at a reconnect boundary', async () => {
    const received: EventEnvelope[] = [];
    let call = 0;
    const http = httpWith(async () => {
      call += 1;
      // サーバが重複して送ってきても二重に届けない
      return call === 1
        ? sseBody([progress(1)])
        : sseBody([progress(1), progress(2), completed(3)]);
    });

    await streamTaskEvents(http, 't1', { onEvent: (e) => received.push(e), backoffMs: () => 0 });
    expect(received.map((e) => e.sequence)).toEqual([1, 2, 3]);
  });

  it('refetches from the gap instead of silently skipping', async () => {
    // 欠番を握り潰すと、取りこぼしに誰も気づけなくなる
    const received: EventEnvelope[] = [];
    const reconnects: string[] = [];
    let call = 0;
    const http = httpWith(async () => {
      call += 1;
      return call === 1
        ? sseBody([progress(1), progress(3)])
        : sseBody([progress(2), completed(3)]);
    });

    await streamTaskEvents(http, 't1', {
      onEvent: (e) => received.push(e),
      backoffMs: () => 0,
      onReconnect: (_attempt, reason) => reconnects.push(reason),
    });

    expect(received.map((e) => e.sequence)).toEqual([1, 2, 3]);
    expect(reconnects[0]).toContain('sequence gap');
  });

  it('advances the sequence for an unknown event type instead of dropping it', async () => {
    const unknown: { sequence: number; type: string }[] = [];
    const received: EventEnvelope[] = [];
    const http = httpWith(async () =>
      sseBody([progress(1), envelope(2, 'future.thing.v9', { x: 1 }), completed(3)]),
    );

    await streamTaskEvents(http, 't1', {
      onEvent: (e) => received.push(e),
      onUnknown: (sequence, type) => unknown.push({ sequence, type }),
    });

    expect(unknown).toEqual([{ sequence: 2, type: 'future.thing.v9' }]);
    expect(received.map((e) => e.sequence)).toEqual([1, 3]);
  });

  it('gives up after the attempt budget rather than hammering forever', async () => {
    const http = httpWith(async () => new Response(null, { status: 503 }));
    const onReconnect = vi.fn();

    const last = await streamTaskEvents(http, 't1', {
      onEvent: () => undefined,
      backoffMs: () => 0,
      maxAttempts: 3,
      onReconnect,
    });

    expect(last).toBe(0);
    expect(onReconnect).toHaveBeenCalledTimes(3);
  });

  it('stops immediately when the caller aborts', async () => {
    const controller = new AbortController();
    const http = httpWith(async () => {
      controller.abort();
      throw new Error('aborted');
    });

    const last = await streamTaskEvents(http, 't1', {
      onEvent: () => undefined,
      signal: controller.signal,
      backoffMs: () => 0,
    });
    expect(last).toBe(0);
  });
});
