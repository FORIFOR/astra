import { afterEach, describe, expect, it, vi } from 'vitest';
import { TokenStore } from '@astra/oauth';
import { cleanup, seedGoogle, seedMicrosoft, type Seeded } from '../src/live-seed.js';
import { liveFixture } from '../src/live-fixture.js';

vi.mock('@astra/oauth', async (original) => ({
  ...(await original<typeof import('@astra/oauth')>()),
  refresh: vi.fn(async (config: { scopes: readonly string[] }) => ({
    accessToken: 'test-only-access',
    grantedScopes: config.scopes,
    refreshToken: 'test-only-refresh',
  })),
}));
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
const now = new Date('2026-09-08T03:00:00Z');
const fixture = liveFixture(now, 'CLEANUP-TEST');

describe.each(['google', 'microsoft'] as const)('%s live fixture lifecycle', (provider) => {
  function credentials() {
    const key = provider === 'google' ? 'GOOGLE' : 'MS';
    vi.stubEnv(`ASTRA_TEST_${key}_CLIENT_ID`, 'test-only-client');
    vi.stubEnv(`ASTRA_TEST_${key}_REFRESH_TOKEN`, 'test-only-refresh');
    vi.stubEnv(`ASTRA_TEST_${key}_READ_REFRESH_TOKEN`, 'test-only-read-refresh');
  }
  function seeded(): Seeded {
    return {
      provider,
      fixture,
      self: 'fixture@example.invalid',
      sink: 'fixture@example.invalid',
      messages: ['m1', 'm2'],
      events: ['e1'],
    };
  }
  it('reports cleanup failures after attempting every resource', async () => {
    credentials();
    const request = vi
      .fn()
      .mockResolvedValueOnce(new Response('denied', { status: 403 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', request);
    await expect(cleanup(seeded())).rejects.toThrow('cleanup failed for 1 resource');
    expect(request).toHaveBeenCalledTimes(3);
  });
  it('can retry cleanup when some resources are already absent', async () => {
    credentials();
    const request = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 404 }))
      .mockResolvedValueOnce(new Response(null, { status: 410 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', request);
    await expect(cleanup(seeded())).resolves.toBeUndefined();
  });
  it('seeds with read credentials only; write credentials are absent until approval', async () => {
    credentials();
    const profile = { emailAddress: 'fixture@example.invalid', mail: 'fixture@example.invalid' };
    const request = vi
      .fn()
      .mockResolvedValueOnce(Response.json(profile))
      .mockResolvedValueOnce(Response.json(profile))
      .mockResolvedValueOnce(Response.json({ id: 'm1' }))
      .mockResolvedValueOnce(Response.json({ id: 'm2' }))
      .mockResolvedValueOnce(Response.json({ id: 'e1' }));
    vi.stubGlobal('fetch', request);
    const writes: string[] = [];
    const store = new TokenStore({
      get: async () => null,
      set: async (key) => {
        writes.push(key);
      },
      delete: async () => {},
    });
    await (provider === 'google' ? seedGoogle : seedMicrosoft)(fixture, store, now, async () => {});
    expect(writes.length).toBe(provider === 'google' ? 2 : 1);
    expect(writes.every((key) => !key.includes('actions'))).toBe(true);
    if (provider === 'google') {
      const init = request.mock.calls[2]![1] as RequestInit;
      const raw = Buffer.from(JSON.parse(String(init.body)).raw, 'base64url').toString('utf8');
      expect(raw).toContain(
        `Subject: =?UTF-8?B?${Buffer.from(fixture.mailA.subject).toString('base64')}?=`,
      );
      expect(raw).toContain('Content-Transfer-Encoding: base64');
      expect(raw).toMatch(/Message-ID: <astra-fixture-[^>]+@astra.invalid>/);
      expect(raw).toContain(`Date: ${new Date(now.getTime() - 2 * 86400000).toUTCString()}`);
    }
  });
  it('does not seed when the read credential belongs to another identity', async () => {
    credentials();
    const request = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({ emailAddress: 'fixture@example.invalid', mail: 'fixture@example.invalid' }),
      )
      .mockResolvedValueOnce(
        Response.json({ emailAddress: 'other@example.invalid', mail: 'other@example.invalid' }),
      );
    vi.stubGlobal('fetch', request);
    const store = new TokenStore({
      get: async () => null,
      set: async () => {},
      delete: async () => {},
    });
    await expect(
      (provider === 'google' ? seedGoogle : seedMicrosoft)(fixture, store, now, async () => {}),
    ).rejects.toThrow('identities differ');
    expect(request.mock.calls.every(([, init]) => init?.method === 'GET')).toBe(true);
  });
  it('journals created IDs before a later seed operation fails', async () => {
    credentials();
    const request = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({ emailAddress: 'fixture@example.invalid', mail: 'fixture@example.invalid' }),
      )
      .mockResolvedValueOnce(
        Response.json({ emailAddress: 'fixture@example.invalid', mail: 'fixture@example.invalid' }),
      )
      .mockResolvedValueOnce(Response.json({ id: 'created-mail' }))
      .mockResolvedValueOnce(new Response('unavailable', { status: 503 }));
    vi.stubGlobal('fetch', request);
    const journal: Seeded[] = [];
    const checkpoint = async (value: Seeded) => {
      journal.push(structuredClone(value));
    };
    const store = new TokenStore({
      get: async () => null,
      set: async () => {},
      delete: async () => {},
    });
    await expect(
      (provider === 'google' ? seedGoogle : seedMicrosoft)(fixture, store, now, checkpoint),
    ).rejects.toThrow('503');
    expect(journal.map((entry) => entry.messages)).toEqual([[], ['created-mail']]);
  });
});
