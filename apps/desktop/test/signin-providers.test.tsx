/**
 * 提供者でのサインイン。実装仕様 §4.3、正本 §21。
 *
 * deepnote-desktop から持ち込んだ流れが、Astra の約束を守っているかを見る:
 *   - サーバへ渡すのは ID トークンだけ（access / refresh token は渡さない）
 *   - 折り返しの state が違えば受け取らない
 *   - 途中でやめたのは失敗ではない（赤い文を出さない）
 */
import type { JSX } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { uuidv7 } from '@astra/contracts';

const loopback = {
  listen: vi.fn(async () => ({ redirectUri: 'http://127.0.0.1:5555/callback', port: 5555 })),
  await: vi.fn<() => Promise<Record<string, string>>>(),
  cancel: vi.fn(async () => undefined),
  openBrowser: vi.fn<(url: string) => Promise<void>>(async () => undefined),
};

vi.mock('../src/host/tauri.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../src/host/tauri.js')>();
  return { ...original, oauthCallback: loopback };
});

const { SessionProvider, useSession } = await import('../src/state/SessionProvider.js');
const { SignIn } = await import('../src/auth/SignIn.js');

afterEach(cleanup);

const now = new Date().toISOString();
const tokens = {
  access_token: 'access-1',
  refresh_token: 'refresh-1',
  device_token: 'device-1',
  expires_in: 900,
  token_type: 'Bearer' as const,
};
const meBody = {
  user: { id: uuidv7(), email: 'a@example.com', display_name: 'Aki', created_at: now },
  tenant: {
    id: uuidv7(),
    name: 'A',
    kind: 'personal',
    compliance_profile: 'GENERAL',
    created_at: now,
  },
  device: {
    id: uuidv7(),
    tenant_id: uuidv7(),
    user_id: uuidv7(),
    platform: 'macos',
    name: 'dev',
    app_version: '0.1.0',
    last_seen_at: null,
    created_at: now,
  },
  role: 'owner',
};
const providers = {
  providers: [
    {
      id: 'google',
      configured: true,
      client_id: 'native.apps.googleusercontent.com',
      relay_path: null,
    },
    { id: 'apple', configured: false, client_id: null, relay_path: null },
    { id: 'line', configured: true, client_id: '1234', relay_path: '/v1/auth/line/desktop' },
  ],
  dev_email: false,
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const button = (name: RegExp): HTMLButtonElement =>
  screen.getByRole('button', { name }) as HTMLButtonElement;

function Probe(): JSX.Element {
  const { status, me } = useSession();
  return (
    <>
      <span data-testid="status">{status}</span>
      <span data-testid="who">{me?.user.display_name ?? '-'}</span>
      {status === 'signed-out' && <SignIn />}
    </>
  );
}

interface Seen {
  idp: Record<string, unknown> | null;
  google: URLSearchParams | null;
}

function makeFetch(seen: Seen) {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith('/v1/auth/providers')) return json(providers);
    if (url.startsWith('https://oauth2.googleapis.com/token')) {
      seen.google = new URLSearchParams(String(init?.body));
      return json({
        access_token: 'g-access',
        id_token: 'g-id-token',
        token_type: 'Bearer',
        expires_in: 3600,
      });
    }
    if (url.endsWith('/v1/auth/idp/token')) {
      seen.idp = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return json(tokens);
    }
    if (url.endsWith('/v1/me')) return json(meBody);
    return json({}, 404);
  });
}

function mount(fetchImpl: ReturnType<typeof makeFetch>): void {
  render(
    <SessionProvider baseUrl="https://astra.test" fetchImpl={fetchImpl as never}>
      <Probe />
    </SessionProvider>,
  );
}

beforeEach(() => {
  loopback.await.mockReset();
  loopback.openBrowser.mockClear();
  loopback.cancel.mockClear();
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: () => ({
      matches: false,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }),
  });
});

describe('sign-in with a provider', () => {
  it('shows only configured providers as pressable, and no email form when dev sign-in is off', async () => {
    mount(makeFetch({ idp: null, google: null }));
    await waitFor(() => expect(button(/Google で続ける/).disabled).toBe(false));
    expect(button(/Apple で続ける/).disabled).toBe(true);
    expect(button(/LINE で続ける/).disabled).toBe(false);
    expect(screen.queryByLabelText('メールアドレス')).toBeNull();
  });

  it('Google: PKCE loopback in the external browser, then only the ID token goes to the gateway', async () => {
    const user = userEvent.setup();
    const seen: Seen = { idp: null, google: null };
    loopback.await.mockImplementation(async () => {
      const opened = new URL(String(loopback.openBrowser.mock.calls[0]?.[0]));
      return { code: 'auth-code', state: opened.searchParams.get('state') ?? '' };
    });
    mount(makeFetch(seen));
    await waitFor(() => expect(button(/Google で続ける/).disabled).toBe(false));
    await user.click(screen.getByRole('button', { name: /Google で続ける/ }));

    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('signed-in'));
    const opened = new URL(String(loopback.openBrowser.mock.calls[0]?.[0]));
    expect(opened.origin + opened.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(opened.searchParams.get('redirect_uri')).toBe('http://127.0.0.1:5555/callback');
    expect(opened.searchParams.get('code_challenge_method')).toBe('S256');
    expect(opened.searchParams.get('scope')).toContain('openid');
    // refresh token は求めない（サインインに要らない）
    expect(opened.searchParams.get('access_type')).toBeNull();
    expect(seen.google?.get('code_verifier')).toBeTruthy();
    expect(seen.google?.get('client_secret')).toBeNull();
    // gateway へは ID トークンだけ
    expect(seen.idp).toMatchObject({ provider: 'google', id_token: 'g-id-token' });
    expect(JSON.stringify(seen.idp)).not.toContain('g-access');
    expect(screen.getByTestId('who').textContent).toBe('Aki');
  });

  it('LINE: goes through the gateway relay and refuses a callback with another state', async () => {
    const user = userEvent.setup();
    const seen: Seen = { idp: null, google: null };
    loopback.await.mockImplementationOnce(async () => ({ id_token: 'line-id', state: 'not-ours' }));
    mount(makeFetch(seen));
    await waitFor(() => expect(button(/LINE で続ける/).disabled).toBe(false));
    await user.click(screen.getByRole('button', { name: /LINE で続ける/ }));

    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    const opened = new URL(String(loopback.openBrowser.mock.calls[0]?.[0]));
    expect(opened.origin + opened.pathname).toBe('https://astra.test/v1/auth/line/desktop');
    expect(opened.searchParams.get('port')).toBe('5555');
    expect(seen.idp).toBeNull();
    expect(loopback.cancel).toHaveBeenCalled();

    // 正しい state なら通る
    loopback.await.mockImplementationOnce(async () => {
      const again = new URL(String(loopback.openBrowser.mock.calls[1]?.[0]));
      return {
        id_token: 'line-id',
        state: again.searchParams.get('state') ?? '',
        display_name: 'Line User',
      };
    });
    await user.click(screen.getByRole('button', { name: /LINE で続ける/ }));
    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('signed-in'));
    expect(seen.idp).toMatchObject({
      provider: 'line',
      id_token: 'line-id',
      display_name: 'Line User',
    });
  });

  it('treats the user closing the browser as a cancel, not a failure', async () => {
    const user = userEvent.setup();
    loopback.await.mockImplementationOnce(async () => ({ error: 'access_denied', state: 'x' }));
    mount(makeFetch({ idp: null, google: null }));
    await waitFor(() => expect(button(/Google で続ける/).disabled).toBe(false));
    await user.click(screen.getByRole('button', { name: /Google で続ける/ }));
    await waitFor(() => expect(button(/Google で続ける/).disabled).toBe(false));
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByTestId('status').textContent).toBe('signed-out');
    expect(loopback.cancel).toHaveBeenCalled();
  });
});
