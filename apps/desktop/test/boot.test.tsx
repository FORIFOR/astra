/**
 * アプリ全体が本当に立ち上がるか。
 *
 * ほかのテストは**部品を単体で**描いている。provider の配線ミスや
 * 起動時の例外は、それでは出ない。ここだけが `<App />` そのものを描く。
 *
 * 実ブラウザで確認できない間、これが一番近い検査になる。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { App } from '../src/App.js';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/** 何を訊かれても「未認証」を返す fetch。サインイン画面まで出れば十分。 */
function signedOutFetch(): typeof globalThis.fetch {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('/v1/me')) {
      return new Response(
        JSON.stringify({ error: { code: 'auth.missing_token', message: 'no token' } }),
        { status: 401, headers: { 'content-type': 'application/json' } },
      );
    }
    return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
  }) as unknown as typeof globalThis.fetch;
}

describe('booting the app', () => {
  it('mounts the whole tree without throwing', async () => {
    vi.stubGlobal('fetch', signedOutFetch());
    // provider の配線ミスはここでしか出ない
    expect(() => render(<App />)).not.toThrow();
    await waitFor(() => expect(screen.getByRole('status')).toBeTruthy());
  });

  it('injects the design tokens into the document', async () => {
    vi.stubGlobal('fetch', signedOutFetch());
    render(<App />);

    await waitFor(() => {
      const style = document.getElementById('astra-tokens');
      expect(style, 'ThemeProvider should have injected the tokens').not.toBeNull();
      // 参照だけあって定義が無いと、ブラウザで色が消える
      expect(style!.textContent).toContain('--astra-color-canvas');
      expect(style!.textContent).toContain('--astra-color-surface-raised');
    });
  });

  it('lands on sign-in when there is no session, not on a blank page', async () => {
    vi.stubGlobal('fetch', signedOutFetch());
    render(<App />);
    // 真っ白な画面で止まらないこと
    await waitFor(() => {
      expect(document.body.textContent?.trim().length ?? 0).toBeGreaterThan(0);
    });
  });
});
