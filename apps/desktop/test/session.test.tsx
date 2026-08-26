/**
 * サインイン状態。実装仕様 §4.2、UI/UX §22。
 */
import type { JSX } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { uuidv7 } from '@astra/contracts';
import { SessionProvider, useSession } from '../src/state/SessionProvider.js';
import { SignIn } from '../src/auth/SignIn.js';

afterEach(cleanup);

const now = new Date().toISOString();

const tokens = (suffix: string) => ({
  access_token: `access-${suffix}`,
  refresh_token: `refresh-${suffix}`,
  device_token: `device-${suffix}`,
  expires_in: 900,
  token_type: 'Bearer' as const,
});

const meBody = {
  user: { id: uuidv7(), email: 'a@example.com', display_name: 'A', created_at: now },
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

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

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

beforeEach(() => {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: () => ({
      matches: false,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }),
  });
});

describe('sign-in', () => {
  it('starts signed out when nothing is stored', async () => {
    const fetchImpl = vi.fn(async () => json({}, 500));
    render(
      <SessionProvider baseUrl="https://astra.test" fetchImpl={fetchImpl as never}>
        <Probe />
      </SessionProvider>,
    );
    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('signed-out'));
    // 保存された refresh token が無いなら、サーバへ問い合わせにも行かない
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('signs in and loads the profile', async () => {
    const user = userEvent.setup();
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/v1/auth/dev/token')) return json(tokens('1'));
      if (url.endsWith('/v1/me')) return json(meBody);
      return json({}, 404);
    });

    render(
      <SessionProvider baseUrl="https://astra.test" fetchImpl={fetchImpl as never}>
        <Probe />
      </SessionProvider>,
    );
    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('signed-out'));

    await user.type(screen.getByLabelText('メールアドレス'), 'a@example.com');
    await user.click(screen.getByRole('button', { name: '始める' }));

    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('signed-in'));
    expect(screen.getByTestId('who').textContent).toBe('A');
  });

  it('never writes the refresh token to browser storage', async () => {
    // ブラウザに安全な保管先が無い以上、保存しない方が正しい（実装仕様 §4.2）
    const user = userEvent.setup();
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/v1/auth/dev/token')) return json(tokens('1'));
      if (url.endsWith('/v1/me')) return json(meBody);
      return json({}, 404);
    });

    render(
      <SessionProvider baseUrl="https://astra.test" fetchImpl={fetchImpl as never}>
        <Probe />
      </SessionProvider>,
    );
    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('signed-out'));
    await user.type(screen.getByLabelText('メールアドレス'), 'a@example.com');
    await user.click(screen.getByRole('button', { name: '始める' }));
    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('signed-in'));

    const stored = JSON.stringify(
      Object.fromEntries(
        Array.from({ length: localStorage.length }, (_, i) => {
          const key = localStorage.key(i)!;
          return [key, localStorage.getItem(key)];
        }),
      ),
    );
    expect(stored).not.toContain('refresh-1');
    expect(stored).not.toContain('access-1');
  });

  it('explains the failure and stays usable', async () => {
    const user = userEvent.setup();
    const fetchImpl = vi.fn(async () =>
      json({ error: { code: 'common.unavailable', message: 'down', request_id: 'r' } }, 503),
    );

    render(
      <SessionProvider baseUrl="https://astra.test" fetchImpl={fetchImpl as never}>
        <Probe />
      </SessionProvider>,
    );
    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('signed-out'));
    await user.type(screen.getByLabelText('メールアドレス'), 'a@example.com');
    await user.click(screen.getByRole('button', { name: '始める' }));

    // §21: 影響と次の行動を書く
    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toContain('接続先を確認して'),
    );
    expect(screen.getByTestId('status').textContent).toBe('signed-out');
  });

  it('refuses to submit an empty address', async () => {
    const user = userEvent.setup();
    const fetchImpl = vi.fn(async () => json({}, 500));
    render(
      <SessionProvider baseUrl="https://astra.test" fetchImpl={fetchImpl as never}>
        <Probe />
      </SessionProvider>,
    );
    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('signed-out'));
    await user.click(screen.getByRole('button', { name: '始める' }));
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
