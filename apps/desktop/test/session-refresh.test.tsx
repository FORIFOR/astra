/**
 * 保存済みの refresh token の扱い。実装仕様 §4.2。
 *
 * 捨てるのはサーバが「無効」と言ったときだけ。レート制限や断で捨てると、
 * サーバが一時的に返事できないだけで利用者がサインアウトされる。
 */
import type { JSX } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';

const store = new Map<string, string>();
vi.mock('../src/host/tauri.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../src/host/tauri.js')>();
  return {
    ...original,
    secrets: {
      get: vi.fn(async (key: string) => store.get(key) ?? null),
      set: vi.fn(async (key: string, value: string) => {
        store.set(key, value);
      }),
      delete: vi.fn(async (key: string) => {
        store.delete(key);
      }),
    },
  };
});

const { SessionProvider, useSession, refreshTokenIsDead } =
  await import('../src/state/SessionProvider.js');
const { AstraError } = await import('@astra/contracts');

function Probe(): JSX.Element {
  const { status, error } = useSession();
  return (
    <>
      <span data-testid="status">{status}</span>
      <span data-testid="error">{error ?? ''}</span>
    </>
  );
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

beforeEach(() => {
  store.clear();
  store.set('astra.refresh_token', 'refresh-kept');
});
afterEach(cleanup);

describe('stored refresh token', () => {
  it('survives a rate-limited refresh (429) and the user is told to try again', async () => {
    const fetchImpl = vi.fn(async () =>
      json({ error: { code: 'common.rate_limited', message: 'slow down', request_id: 'r' } }, 429),
    );
    render(
      <SessionProvider baseUrl="https://astra.test" fetchImpl={fetchImpl as never}>
        <Probe />
      </SessionProvider>,
    );
    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('signed-out'));
    expect(store.get('astra.refresh_token')).toBe('refresh-kept');
    expect(screen.getByTestId('error').textContent).toContain('接続先に届きません');
  });

  it('is discarded when the server says the token is invalid (reuse / expiry)', async () => {
    const fetchImpl = vi.fn(async () =>
      json(
        { error: { code: 'auth.refresh_reuse_detected', message: 'reuse', request_id: 'r' } },
        401,
      ),
    );
    render(
      <SessionProvider baseUrl="https://astra.test" fetchImpl={fetchImpl as never}>
        <Probe />
      </SessionProvider>,
    );
    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('signed-out'));
    expect(store.get('astra.refresh_token')).toBeUndefined();
  });

  it('classifies only auth.* errors as dead', () => {
    expect(refreshTokenIsDead(new AstraError('auth.expired_token', 'x'))).toBe(true);
    expect(refreshTokenIsDead(new AstraError('common.rate_limited', 'x'))).toBe(false);
    expect(refreshTokenIsDead(new TypeError('fetch failed'))).toBe(false);
  });
});
