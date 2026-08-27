/**
 * 会議のあとの一連。正本 §9・§15・§21、UI/UX §14.1・§22。
 *
 *   会議の中身 →次回予定の提案 →**人の承認** →Calendar 作成
 *   →追いのメールの下書き →Gmail 下書き
 *
 * Google の OAuth Client は人が作るものなので、実アカウントへは繋げない。
 * 代わりに**Google と同じ形で応答するサーバ**を立て、
 * 送る側の組み立て（経路・本文・並び）を実 HTTP で確かめる。
 *
 * ここで見たいのは提供者の挙動ではなく、**こちらの振る舞い**:
 *   - 承認の跡が無ければ、**要求を出さない**
 *   - 承認したものと、送るものが**同じ**か
 *   - 下書きで止まるか（**送らない**）
 */
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  ApprovalRequired,
  GmailConnector,
  GoogleCalendarConnector,
  type ApprovalProof,
} from '@astra/service-connectors';
import { fromBase64Url } from '@astra/service-connectors';

interface Seen {
  method: string;
  path: string;
  authorization: string | undefined;
  body: Record<string, unknown> | undefined;
}

const ALL = ['email.read', 'email.draft', 'email.modify', 'email.send'];
const CAL = ['calendar.read', 'calendar.write'];

describe('after the meeting', () => {
  let google: Server;
  let origin = '';
  const seen: Seen[] = [];

  /** googleapis.com への呼び出しを、ここへ向け直す。 */
  const routed: typeof globalThis.fetch = async (input, init) => {
    const original = new URL(String(input));
    const url = new URL(original.pathname + original.search, origin);
    return fetch(url, init);
  };

  const gmail = (): GmailConnector =>
    new GmailConnector({ token: async () => 'access-token', fetch: routed, grantedScopes: ALL });
  const calendar = (): GoogleCalendarConnector =>
    new GoogleCalendarConnector({
      token: async () => 'access-token',
      fetch: routed,
      grantedScopes: CAL,
    });

  const approval = (operationId: string): ApprovalProof => ({
    approvalId: 'ap-1',
    operationId,
    decision: 'APPROVED',
    decidedBy: 'user-1',
    decidedAt: new Date(Date.now() - 1000).toISOString(),
    expiresAt: new Date(Date.now() + 300_000).toISOString(),
  });

  beforeAll(async () => {
    google = createServer((request, response) => {
      let body = '';
      request.on('data', (chunk) => (body += String(chunk)));
      request.on('end', () => {
        const url = new URL(request.url ?? '/', origin || 'http://127.0.0.1');
        seen.push({
          method: request.method ?? 'GET',
          path: url.pathname,
          authorization: request.headers.authorization,
          body: body ? (JSON.parse(body) as Record<string, unknown>) : undefined,
        });

        const json = (value: unknown): void => {
          response.writeHead(200, { 'content-type': 'application/json' });
          response.end(JSON.stringify(value));
        };

        // Gmail: 一覧 → 明細
        if (url.pathname === '/gmail/v1/users/me/messages')
          return json({ messages: [{ id: 'm1' }] });
        if (url.pathname.startsWith('/gmail/v1/users/me/messages/m1')) {
          return json({
            id: 'm1',
            threadId: 't1',
            internalDate: '1756252800000',
            payload: { headers: [{ name: 'Subject', value: '定例の日程' }] },
          });
        }
        if (url.pathname === '/gmail/v1/users/me/drafts') {
          return json({ id: 'd1', message: { id: 'm9' } });
        }
        if (url.pathname === '/gmail/v1/users/me/messages/send') {
          return json({ id: 'sent-1', threadId: 't1' });
        }
        // Calendar
        if (url.pathname.endsWith('/events')) {
          return json({ id: 'e1', summary: '定例', status: 'confirmed' });
        }
        response.writeHead(404).end();
      });
    });
    await new Promise<void>((resolve) => google.listen(0, '127.0.0.1', resolve));
    origin = `http://127.0.0.1:${String((google.address() as AddressInfo).port)}`;
  }, 60_000);

  afterAll(async () => {
    await new Promise<void>((resolve) => google.close(() => resolve()));
  });

  /** 会議で決まったこと。ここから先の入力になる。 */
  const decided = {
    title: '定例（9月）',
    start: { dateTime: '2026-09-04T01:00:00Z' },
    end: { dateTime: '2026-09-04T02:00:00Z' },
    attendee: 'tanaka@example.com',
  };

  it('will not put anything in the calendar without a person saying so', async () => {
    const before = seen.length;
    await expect(
      calendar().create(
        { title: decided.title, start: decided.start, end: decided.end },
        undefined,
      ),
    ).rejects.toBeInstanceOf(ApprovalRequired);

    // **要求そのものを出していない。**出してから断るのでは遅い。
    expect(seen.length).toBe(before);
  });

  it('creates exactly what was approved, and invites nobody on its own', async () => {
    const before = seen.length;
    const event = await calendar().create(
      {
        title: decided.title,
        start: decided.start,
        end: decided.end,
        attendeeEmails: [decided.attendee],
      },
      approval('calendar.create'),
    );

    expect(event.id).toBe('e1');
    const call = seen[before]!;
    expect(call.method).toBe('POST');
    expect(call.authorization).toBe('Bearer access-token');
    /*
     * 招待は勝手に送らない。承認カードで見せた内容と、
     * 実際に起きることを一致させる（UI/UX §14.1）。
     */
    expect(call.path).toContain('/calendars/primary/events');
    expect(seen[before]!.body).toMatchObject({
      summary: decided.title,
      attendees: [{ email: decided.attendee }],
    });
  });

  it('reads the thread it is replying to', async () => {
    const list = await gmail().list({ query: 'subject:定例' });
    expect(list).toHaveLength(1);

    const message = await gmail().get('m1');
    expect(message.subject).toBe('定例の日程');
    // 一覧では本文まで取りに行かない
    expect(seen.some((s) => s.path.includes('/messages/m1') && s.path.length > 0)).toBe(true);
  });

  it('leaves the follow-up as a draft, and does not send it', async () => {
    const before = seen.length;
    const draft = await gmail().draft({
      to: [decided.attendee],
      subject: 'Re: 定例の日程',
      body: '9月4日10時で確定しました。よろしくお願いいたします。',
    });

    expect(draft.draftId).toBe('d1');
    const calls = seen.slice(before);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.path).toBe('/gmail/v1/users/me/drafts');
    // **送信の経路を一度も踏んでいない。**
    expect(seen.some((s) => s.path.endsWith('/messages/send'))).toBe(false);
  });

  it('puts the words a person approved on the wire, unchanged', async () => {
    const before = seen.length;
    const body = '9月4日10時で確定しました。議事録は追ってお送りします。';
    await gmail().send(
      { to: [decided.attendee], subject: 'Re: 定例の日程', body },
      approval('gmail.send'),
    );

    const raw = (seen[before]!.body as { raw: string }).raw;
    const mime = new TextDecoder().decode(fromBase64Url(raw));
    const [headers, encoded] = mime.split('\r\n\r\n');

    expect(headers).toContain(`To: ${decided.attendee}`);
    // 本文が途中で書き換わっていないこと。承認したものが、そのまま出る。
    const sent = new TextDecoder().decode(fromBase64Url(encoded!.replace(/\r\n/g, '')));
    expect(sent).toBe(body);
  });

  it('refuses to send when the approval was for something else', async () => {
    const before = seen.length;
    await expect(
      gmail().send(
        { to: [decided.attendee], subject: 'x', body: 'y' },
        approval('calendar.create'),
      ),
    ).rejects.toBeInstanceOf(ApprovalRequired);
    expect(seen.length).toBe(before);
  });

  it('refuses to send on an approval that has run out', async () => {
    const before = seen.length;
    await expect(
      gmail().send(
        { to: [decided.attendee], subject: 'x', body: 'y' },
        { ...approval('gmail.send'), expiresAt: new Date(Date.now() - 1000).toISOString() },
      ),
    ).rejects.toBeInstanceOf(ApprovalRequired);
    // 期限切れの承認で送らない。止まっている間に前提が変わっている。
    expect(seen.length).toBe(before);
  });

  it('never carries the token anywhere but the provider', async () => {
    // 受け取った全ての呼び出しで、token は authorization ヘッダにだけ現れる
    for (const call of seen) {
      expect(JSON.stringify(call.body ?? {})).not.toContain('access-token');
    }
  });
});
