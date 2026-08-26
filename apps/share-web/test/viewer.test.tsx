/**
 * 共有 viewer。Phase 2 実装仕様 §2、正本 §2.3。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { PublicShareClient } from '@astra/api-client';
import { ShareViewer } from '../src/ShareViewer.js';

afterEach(cleanup);

const TOKEN = 'v1.01a03000-0000-7000-8000-000000000001.' + 'a'.repeat(43);

const artifact = (over: Record<string, unknown> = {}) => ({
  title: 'A社 提案書',
  mime_type: 'text/markdown',
  size: 42,
  created_at: '2026-08-26T00:00:00.000Z',
  policy: { allow_download: false, watermark: false },
  ...over,
});

function makeClient(handler: (url: string, init?: RequestInit) => Response): PublicShareClient {
  return new PublicShareClient({
    baseUrl: 'https://api.astra.test',
    fetch: (async (input: RequestInfo | URL, init?: RequestInit) =>
      handler(String(input), init)) as typeof globalThis.fetch,
  });
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const unlocked = (over: Record<string, unknown> = {}) =>
  json({ view_token: 'view-1', expires_in: 300, artifact: artifact(over) });

describe('opening a share', () => {
  it('reads the token from the fragment and never puts it in a url', async () => {
    const urls: string[] = [];
    const bodies: string[] = [];
    const client = makeClient((url, init) => {
      urls.push(url);
      if (init?.body) bodies.push(String(init.body));
      return url.endsWith('/unlock') ? unlocked() : new Response('# 中身');
    });

    render(<ShareViewer client={client} hash={`#${TOKEN}`} />);
    await waitFor(() => expect(screen.getByText('A社 提案書')).toBeTruthy());

    // 秘密は本文で送る。URL には出さない。
    expect(urls.every((u) => !u.includes(TOKEN))).toBe(true);
    expect(bodies.some((b) => b.includes(TOKEN))).toBe(true);
  });

  it('says so plainly when there is no link at all', async () => {
    const client = makeClient(() => json({}, 404));
    render(<ShareViewer client={client} hash="" />);
    await waitFor(() => expect(screen.getByText('リンクが見つかりません')).toBeTruthy());
  });

  it('renders text content it can display', async () => {
    const client = makeClient((url) =>
      url.endsWith('/unlock') ? unlocked() : new Response('# 見出し\n\n本文'),
    );
    render(<ShareViewer client={client} hash={`#${TOKEN}`} />);
    await waitFor(() => expect(screen.getByText(/# 見出し/)).toBeTruthy());
  });

  it('does not try to render a format it cannot show', async () => {
    const client = makeClient((url) =>
      url.endsWith('/unlock') ? unlocked({ mime_type: 'application/pdf' }) : new Response('binary'),
    );
    render(<ShareViewer client={client} hash={`#${TOKEN}`} />);
    await waitFor(() =>
      expect(screen.getByText('この形式はここでは表示できません。')).toBeTruthy(),
    );
  });
});

describe('when the link needs more', () => {
  it('asks once, then opens with what was given', async () => {
    const user = userEvent.setup();
    let attempts = 0;
    const client = makeClient((url, init) => {
      if (!url.endsWith('/unlock')) return new Response('# 中身');
      attempts += 1;
      const body = JSON.parse(String(init?.body ?? '{}')) as { password?: string };
      return body.password === 'correct horse' ? unlocked() : json({}, 404);
    });

    render(<ShareViewer client={client} hash={`#${TOKEN}`} />);
    await waitFor(() => expect(screen.getByText('確認が必要です')).toBeTruthy());

    await user.type(screen.getByLabelText('パスワード'), 'correct horse');
    await user.click(screen.getByRole('button', { name: '開く' }));

    await waitFor(() => expect(screen.getByText('A社 提案書')).toBeTruthy());
    expect(attempts).toBe(2);
  });

  it('lets the visitor try again after a mistyped password', async () => {
    // 打ち間違いで行き止まりにしない
    const user = userEvent.setup();
    let attempts = 0;
    const client = makeClient((url, init) => {
      if (!url.endsWith('/unlock')) return new Response('# 中身');
      attempts += 1;
      const body = JSON.parse(String(init?.body ?? '{}')) as { password?: string };
      return body.password === 'right' ? unlocked() : json({}, 404);
    });

    render(<ShareViewer client={client} hash={`#${TOKEN}`} />);
    await waitFor(() => expect(screen.getByText('確認が必要です')).toBeTruthy());

    await user.type(screen.getByLabelText('パスワード'), 'wrong');
    await user.click(screen.getByRole('button', { name: '開く' }));
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());

    // 「パスワードが違います」と書くと、リンク自体は有効だと教えることになる
    const alert = screen.getByRole('alert').textContent ?? '';
    expect(alert).toContain('共有した相手にご確認ください');
    expect(alert).not.toContain('パスワード');

    await user.clear(screen.getByLabelText('パスワード'));
    await user.type(screen.getByLabelText('パスワード'), 'right');
    await user.click(screen.getByRole('button', { name: '開く' }));
    await waitFor(() => expect(screen.getByText('A社 提案書')).toBeTruthy());
    expect(attempts).toBe(3);
  });

  it('tells the visitor to wait when the attempts are throttled', async () => {
    const client = makeClient(() => json({}, 429));
    render(<ShareViewer client={client} hash={`#${TOKEN}`} />);
    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toContain('試行が多すぎます'),
    );
  });
});

describe('download policy', () => {
  it('offers no download when the share forbids it', async () => {
    const client = makeClient((url) => (url.endsWith('/unlock') ? unlocked() : new Response('x')));
    render(<ShareViewer client={client} hash={`#${TOKEN}`} />);
    await waitFor(() => expect(screen.getByText('A社 提案書')).toBeTruthy());
    expect(screen.queryByRole('button', { name: 'ダウンロード' })).toBeNull();
    expect(screen.getByText('この共有ではダウンロードできません。')).toBeTruthy();
  });

  it('offers it when the share allows it', async () => {
    const client = makeClient((url) =>
      url.endsWith('/unlock')
        ? unlocked({ policy: { allow_download: true, watermark: false } })
        : new Response('x'),
    );
    render(<ShareViewer client={client} hash={`#${TOKEN}`} />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'ダウンロード' })).toBeTruthy());
  });
});

describe('what the page reveals', () => {
  it('shows nothing about the organisation behind the artifact', async () => {
    const client = makeClient((url) =>
      url.endsWith('/unlock') ? unlocked() : new Response('# x'),
    );
    render(<ShareViewer client={client} hash={`#${TOKEN}`} />);
    await waitFor(() => expect(screen.getByText('A社 提案書')).toBeTruthy());

    const page = document.body.textContent ?? '';
    for (const leak of ['tenant', 'owner', 'Astra', 'workspace']) {
      expect(page.toLowerCase()).not.toContain(leak.toLowerCase());
    }
  });

  it('marks the page for a watermark when the share asks for one', async () => {
    const client = makeClient((url) =>
      url.endsWith('/unlock')
        ? unlocked({ policy: { allow_download: false, watermark: true } })
        : new Response('# x'),
    );
    render(<ShareViewer client={client} hash={`#${TOKEN}`} />);
    await waitFor(() => expect(screen.getByText('A社 提案書')).toBeTruthy());
    expect(document.querySelector('.share')?.getAttribute('data-watermark')).toBe('true');
  });
});
