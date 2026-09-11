import { describe, it, expect } from 'vitest';
import { ApiSession } from '../src/api-session.js';

function fixture(handler: typeof fetch) {
  let stored: string | null = 'refresh-1';
  let now = 1_000_000;
  const session = new ApiSession({
    baseUrl: 'http://127.0.0.1:3000',
    fetch: handler,
    now: () => now,
    secrets: {
      get: async () => stored,
      set: async (_k, v) => {
        stored = v;
      },
      delete: async () => {
        stored = null;
      },
    },
  });
  return {
    session,
    advance: () => {
      now += 901_000;
    },
    saved: () => stored,
  };
}
function reply(n: number) {
  return Response.json({
    access_token: `access-${n}`,
    refresh_token: `refresh-${n + 1}`,
    expires_in: 900,
  });
}

describe('renewable API session', () => {
  it('rotates once for concurrent expiry and reuses rotated credentials after restart', async () => {
    let rotations = 0;
    const auth: string[] = [];
    const f = fixture(async (input, init) => {
      const request = new Request(input, init);
      if (request.url.endsWith('/refresh')) {
        rotations++;
        return reply(rotations);
      }
      auth.push(request.headers.get('authorization')!);
      return Response.json({ ok: true });
    });
    await f.session.start();
    f.advance();
    await Promise.all(
      Array.from({ length: 12 }, () => f.session.fetch('http://127.0.0.1:3000/v1/tasks')),
    );
    expect(rotations).toBe(2);
    expect(JSON.parse(f.saved()!).refreshToken).toBe('refresh-3');
    expect(new Set(auth)).toEqual(new Set(['Bearer access-2']));
  });
  it('retries an authentication rejection once, preserving the mutation body', async () => {
    let rotations = 0;
    const bodies: string[] = [];
    const f = fixture(async (input, init) => {
      const r = new Request(input, init);
      if (r.url.endsWith('/refresh')) return reply(++rotations);
      bodies.push(await r.text());
      return bodies.length === 1
        ? Response.json({ error: { code: 'auth.expired_token' } }, { status: 401 })
        : Response.json({ ok: true });
    });
    await f.session.start();
    expect(
      (
        await f.session.fetch('http://127.0.0.1:3000/v1/host-steps/claim', {
          method: 'POST',
          body: '{"host_id":"same"}',
        })
      ).status,
    ).toBe(200);
    expect(rotations).toBe(2);
    expect(bodies).toEqual(['{"host_id":"same"}', '{"host_id":"same"}']);
  });
  it('never repeats a mutation on a server failure or a lost response', async () => {
    for (const failure of ['server', 'network']) {
      let mutations = 0;
      const f = fixture(async (input, init) => {
        const r = new Request(input, init);
        if (r.url.endsWith('/refresh')) return reply(1);
        mutations++;
        if (failure === 'network') throw new Error('lost response');
        return new Response(null, { status: 503 });
      });
      await f.session.start();
      await f.session
        .fetch('http://127.0.0.1:3000/v1/tasks', { method: 'POST', body: 'same' })
        .catch(() => {});
      expect(mutations).toBe(1);
    }
  });
  it('does not replay a refresh whose response may have been lost, or leak credentials to another origin', async () => {
    let calls = 0;
    const f = fixture(async () => {
      calls++;
      throw new Error('lost refresh response');
    });
    await expect(f.session.start()).rejects.toThrow('safely');
    await expect(f.session.token()).rejects.toThrow('safely');
    expect(calls).toBe(1);
    await expect(f.session.fetch('https://example.com/v1/tasks')).rejects.toThrow('another origin');
    expect(calls).toBe(1);
  });
  it('backs off a rate limit without treating it as a consumed refresh', async () => {
    let calls = 0;
    const f = fixture(async () => (++calls === 1 ? new Response(null, { status: 429 }) : reply(1)));
    await expect(f.session.start()).rejects.toThrow('rate limited');
    await expect(f.session.token()).rejects.toThrow('waiting');
    expect(calls).toBe(1);
    f.advance();
    expect(await f.session.token()).toBe('access-1');
    expect(calls).toBe(2);
  });
});

it('does not replay an unrelated upstream 401', async () => {
  let calls = 0;
  const f = fixture(async (input, init) => {
    const r = new Request(input, init);
    if (r.url.endsWith('/refresh')) return reply(1);
    calls++;
    return Response.json({ error: { code: 'connector.unauthorized' } }, { status: 401 });
  });
  await f.session.start();
  expect(
    (await f.session.fetch('http://127.0.0.1:3000/v1/tasks', { method: 'POST', body: 'same' }))
      .status,
  ).toBe(401);
  expect(calls).toBe(1);
});

it('does not replay an interrupted refresh after a process restart', async () => {
  let stored: string | null = 'old-refresh';
  let requests = 0;
  const secrets = {
    get: async () => stored,
    set: async (_k: string, value: string) => {
      stored = value;
    },
    delete: async () => {},
  };
  const fetcher: typeof fetch = async () => {
    requests++;
    throw new Error('response lost after server rotation');
  };
  const options = { baseUrl: 'http://127.0.0.1:3000', secrets, fetch: fetcher };
  await expect(new ApiSession(options).start()).rejects.toThrow('safely');
  await expect(new ApiSession(options).start()).rejects.toThrow('interrupted');
  expect(requests).toBe(1);
});
