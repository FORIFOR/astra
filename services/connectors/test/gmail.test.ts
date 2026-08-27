import { describe, expect, it, vi } from 'vitest';
import { GmailConnector } from '../src/gmail.js';
import { ApprovalRequired, type ApprovalProof } from '../src/approval.js';
import { ConnectorError } from '../src/http.js';
import { fromBase64Url, toBase64Url } from '../src/mime.js';

const ALL = ['email.read', 'email.draft', 'email.modify', 'email.send'];
const NOW = (): Date => new Date('2026-08-27T00:00:00.000Z');

const proof = (operationId: string): ApprovalProof => ({
  approvalId: 'ap-1',
  operationId,
  decision: 'APPROVED',
  decidedBy: 'user-1',
  decidedAt: '2026-08-26T23:59:00.000Z',
  expiresAt: '2026-08-27T00:05:00.000Z',
});

interface Call {
  url: string;
  method: string;
  body: unknown;
  authorization: string | undefined;
}

function fakeFetch(routes: (url: string) => { status?: number; body: unknown }): {
  fetch: typeof globalThis.fetch;
  calls: Call[];
} {
  const calls: Call[] = [];
  const fetch = (async (url: string, init: RequestInit) => {
    const headers = init.headers as Record<string, string>;
    calls.push({
      url,
      method: init.method ?? 'GET',
      body: init.body ? JSON.parse(init.body as string) : undefined,
      authorization: headers?.['authorization'],
    });
    const route = routes(url);
    return new Response(JSON.stringify(route.body), { status: route.status ?? 200 });
  }) as unknown as typeof globalThis.fetch;
  return { fetch, calls };
}

const encode = (s: string): string => toBase64Url(new TextEncoder().encode(s));

describe('GmailConnector', () => {
  it('asks for the token at call time and never stores it', async () => {
    const token = vi.fn().mockResolvedValue('tok-1');
    const { fetch, calls } = fakeFetch(() => ({ body: { messages: [] } }));
    const gmail = new GmailConnector({ token, fetch, grantedScopes: ALL, now: NOW });

    await gmail.list();
    await gmail.list();

    // 呼ぶたびに取りに行く。手元に貯めていたら 1 回で済んでしまう。
    expect(token).toHaveBeenCalledTimes(2);
    expect(calls[0]!.authorization).toBe('Bearer tok-1');
    expect(JSON.stringify(gmail)).not.toContain('tok-1');
  });

  it('fetches only metadata for a listing, not the bodies', async () => {
    const { fetch, calls } = fakeFetch((url) =>
      url.includes('/messages?')
        ? { body: { messages: [{ id: 'm1' }] } }
        : {
            body: {
              id: 'm1',
              threadId: 't1',
              snippet: 'hello',
              internalDate: '1756252800000',
              labelIds: ['UNREAD'],
              payload: {
                headers: [
                  { name: 'From', value: 'a@example.com' },
                  { name: 'Subject', value: '会議のお知らせ' },
                  { name: 'To', value: 'me@example.com, other@example.com' },
                ],
              },
            },
          },
    );
    const gmail = new GmailConnector({
      token: async () => 't',
      fetch,
      grantedScopes: ALL,
      now: NOW,
    });

    const [message] = await gmail.list({ query: 'is:unread' });

    expect(calls[1]!.url).toContain('format=metadata');
    expect(calls[1]!.url).not.toContain('format=full');
    expect(message).toMatchObject({
      id: 'm1',
      subject: '会議のお知らせ',
      unread: true,
      to: ['me@example.com', 'other@example.com'],
      receivedAt: '2025-08-27T00:00:00.000Z',
    });
  });

  it('skips the detail round trip entirely when nothing matched', async () => {
    const { fetch, calls } = fakeFetch(() => ({ body: {} }));
    const gmail = new GmailConnector({ token: async () => 't', fetch, grantedScopes: ALL });
    expect(await gmail.list({ query: 'nope' })).toEqual([]);
    expect(calls).toHaveLength(1);
  });

  it('reads a full message with its body and attachments', async () => {
    const { fetch } = fakeFetch(() => ({
      body: {
        id: 'm1',
        threadId: 't1',
        internalDate: '1756252800000',
        payload: {
          headers: [
            { name: 'Subject', value: 'Re: 見積もり' },
            { name: 'Message-ID', value: '<abc@mail>' },
            { name: 'Cc', value: 'c@example.com' },
          ],
          mimeType: 'multipart/mixed',
          parts: [
            { mimeType: 'text/plain', body: { data: encode('確認しました。') } },
            { mimeType: 'application/pdf', filename: 'quote.pdf', body: { size: 9 } },
          ],
        },
      },
    }));
    const gmail = new GmailConnector({ token: async () => 't', fetch, grantedScopes: ALL });

    const message = await gmail.get('m1');

    expect(message.body).toBe('確認しました。');
    expect(message.bodyIsHtml).toBe(false);
    expect(message.hasAttachments).toBe(true);
    expect(message.attachments[0]!.filename).toBe('quote.pdf');
    expect(message.messageIdHeader).toBe('<abc@mail>');
    expect(message.cc).toEqual(['c@example.com']);
  });

  it('creates a draft without approval, and does not send it', async () => {
    const { fetch, calls } = fakeFetch(() => ({ body: { id: 'd1', message: { id: 'm9' } } }));
    const gmail = new GmailConnector({
      token: async () => 't',
      fetch,
      grantedScopes: ALL,
      now: NOW,
    });

    const draft = await gmail.draft({
      to: ['a@example.com'],
      subject: '週次報告',
      body: '添付のとおりです。',
    });

    expect(draft).toEqual({ draftId: 'd1', messageId: 'm9' });
    expect(calls[0]!.url).toContain('/drafts');
    expect(calls[0]!.url).not.toContain('/send');
  });

  it('will not send without an approval, and issues no request at all', async () => {
    const { fetch, calls } = fakeFetch(() => ({ body: {} }));
    const gmail = new GmailConnector({
      token: async () => 't',
      fetch,
      grantedScopes: ALL,
      now: NOW,
    });

    await expect(
      gmail.send({ to: ['a@example.com'], subject: 's', body: 'b' }, undefined),
    ).rejects.toBeInstanceOf(ApprovalRequired);
    // 送らなかっただけでなく、送信の要求すら出していない
    expect(calls).toHaveLength(0);
  });

  it('will not send on an approval that was granted for the draft operation', async () => {
    const { fetch, calls } = fakeFetch(() => ({ body: {} }));
    const gmail = new GmailConnector({
      token: async () => 't',
      fetch,
      grantedScopes: ALL,
      now: NOW,
    });
    await expect(
      gmail.send({ to: ['a@example.com'], subject: 's', body: 'b' }, proof('gmail.draft')),
    ).rejects.toBeInstanceOf(ApprovalRequired);
    expect(calls).toHaveLength(0);
  });

  it('sends what the approval described, with the subject intact', async () => {
    const { fetch, calls } = fakeFetch(() => ({ body: { id: 'm1', threadId: 't1' } }));
    const gmail = new GmailConnector({
      token: async () => 't',
      fetch,
      grantedScopes: ALL,
      now: NOW,
    });

    const sent = await gmail.send(
      { to: ['a@example.com'], subject: '請求書の件', body: 'よろしくお願いします。' },
      proof('gmail.send'),
    );

    expect(sent).toEqual({ messageId: 'm1', threadId: 't1' });
    const raw = new TextDecoder().decode(fromBase64Url((calls[0]!.body as { raw: string }).raw));
    expect(raw).toContain('To: a@example.com');
    expect(raw).toContain('=?UTF-8?B?');
    expect(raw).toContain('Content-Type: text/plain; charset="UTF-8"');
  });

  it('refuses to send when only the read scope was granted', async () => {
    const { fetch, calls } = fakeFetch(() => ({ body: {} }));
    const gmail = new GmailConnector({
      token: async () => 't',
      fetch,
      grantedScopes: ['email.read'],
      now: NOW,
    });
    await expect(
      gmail.send({ to: ['a@example.com'], subject: 's', body: 'b' }, proof('gmail.send')),
    ).rejects.toMatchObject({ reason: 'insufficient_scope' });
    expect(calls).toHaveLength(0);
  });

  it('refuses a draft with no recipient, or a malformed address', async () => {
    const { fetch, calls } = fakeFetch(() => ({ body: {} }));
    const gmail = new GmailConnector({ token: async () => 't', fetch, grantedScopes: ALL });

    await expect(gmail.draft({ to: [], subject: 's', body: 'b' })).rejects.toBeInstanceOf(
      ConnectorError,
    );
    await expect(
      gmail.draft({ to: ['not-an-address'], subject: 's', body: 'b' }),
    ).rejects.toBeInstanceOf(ConnectorError);
    expect(calls).toHaveLength(0);
  });

  it('trashes rather than deletes, and only with approval', async () => {
    const { fetch, calls } = fakeFetch(() => ({ body: {} }));
    const gmail = new GmailConnector({
      token: async () => 't',
      fetch,
      grantedScopes: ALL,
      now: NOW,
    });

    await expect(gmail.trash('m1', undefined)).rejects.toBeInstanceOf(ApprovalRequired);
    await gmail.trash('m1', proof('gmail.trash'));

    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toContain('/trash');
    // 完全な削除は呼ばない
    expect(calls[0]!.method).toBe('POST');
  });

  it('names what the user must do for each kind of failure', async () => {
    const cases: { status: number; message: string; reason: string }[] = [
      { status: 401, message: 'Invalid Credentials', reason: 'token_expired' },
      {
        status: 403,
        message: 'Request had insufficient authentication scopes',
        reason: 'insufficient_scope',
      },
      { status: 403, message: 'Gmail API has not been used', reason: 'permission_denied' },
      { status: 404, message: 'Not Found', reason: 'not_found' },
      { status: 429, message: 'User-rate limit exceeded', reason: 'rate_limited' },
      { status: 500, message: 'Backend Error', reason: 'provider_error' },
    ];

    for (const { status, message, reason } of cases) {
      const { fetch } = fakeFetch(() => ({ status, body: { error: { message } } }));
      const gmail = new GmailConnector({ token: async () => 't', fetch, grantedScopes: ALL });
      await expect(gmail.get('m1')).rejects.toMatchObject({ reason });
    }
  });

  it('does not treat an unreadable body as a success', async () => {
    const fetch = (async () =>
      new Response('<html>proxy error</html>', {
        status: 502,
      })) as unknown as typeof globalThis.fetch;
    const gmail = new GmailConnector({ token: async () => 't', fetch, grantedScopes: ALL });
    await expect(gmail.get('m1')).rejects.toMatchObject({ reason: 'provider_error' });
  });

  it('does not disguise "not connected" as a timeout', async () => {
    /*
     * トークンを取る所で失敗したのを通信の失敗として返していた。
     * 画面には「接続先が時間内に返りませんでした」と出るので、
     * **繋いでいないことに気づけない。**
     */
    const { fetch, calls } = fakeFetch(() => ({ body: {} }));
    const gmail = new GmailConnector({
      token: async () => {
        throw new ConnectorError('not_connected', 'com.astra.gmail is not connected');
      },
      fetch,
      grantedScopes: ALL,
    });

    await expect(gmail.get('m1')).rejects.toMatchObject({ reason: 'not_connected' });
    expect(calls).toEqual([]);
  });

  it('stops on cancellation before it reaches the network', async () => {
    const { fetch, calls } = fakeFetch(() => ({ body: {} }));
    const gmail = new GmailConnector({ token: async () => 't', fetch, grantedScopes: ALL });
    const controller = new AbortController();
    controller.abort();

    await expect(gmail.get('m1', controller.signal)).rejects.toMatchObject({ reason: 'timed_out' });
    expect(calls).toHaveLength(0);
  });
});
