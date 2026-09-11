/** Provider observations, independent of the task's claimed send result. */
import { liveTokens, LIVE_SCOPES, type LiveProvider } from './live-oauth.js';
export interface ObservedMail {
  id: string;
  subject: string;
  body: string;
  to: string[];
  thread: string;
  sent: boolean;
  received: boolean;
}
export interface ExpectedReply {
  subject: string;
  body: string;
  to: string;
  thread: string;
  nonce: string;
}
export function checkReceipt(mails: ObservedMail[], expected: ExpectedReply): boolean {
  const sent = mails.filter((mail) => mail.sent);
  const received = mails.filter((mail) => mail.received);
  const normalize = (body: string) => body.replace(/\r\n/g, '\n').trim();
  const matches = (mail: ObservedMail) =>
    mail.subject === expected.subject &&
    normalize(mail.body) === normalize(expected.body) &&
    mail.to.length === 1 &&
    mail.to[0]?.toLowerCase() === expected.to.toLowerCase() &&
    Boolean(expected.thread) &&
    mail.thread === expected.thread;
  return sent.length === 1 && received.length === 1 && matches(sent[0]!) && matches(received[0]!);
}
async function get<T>(url: string, access: string): Promise<T> {
  const response = await fetch(url, {
    headers: { authorization: `Bearer ${access}`, Prefer: 'outlook.body-content-type="text"' },
  });
  if (!response.ok) throw new Error(`mail observation failed: HTTP ${response.status}`);
  return (await response.json()) as T;
}
interface GmailPart {
  mimeType?: string;
  body?: { data?: string };
  parts?: GmailPart[];
}
function plain(part: GmailPart): string {
  if (part.mimeType === 'text/plain' && part.body?.data)
    return Buffer.from(part.body.data, 'base64url').toString('utf8');
  return (part.parts ?? []).map(plain).filter(Boolean).join('\n');
}
export async function observeReplies(
  provider: LiveProvider,
  nonce: string,
  project: string,
): Promise<ObservedMail[]> {
  const tokens = await liveTokens(provider, LIVE_SCOPES[provider].read, 'read');
  if (provider === 'google') {
    const base = 'https://gmail.googleapis.com/gmail/v1/users/me/messages';
    const list = await get<{ messages?: { id: string }[]; nextPageToken?: string }>(
      `${base}?q=${encodeURIComponent(`"[live ${nonce}]" -in:trash`)}&maxResults=100`,
      tokens.accessToken,
    );
    if (list.nextPageToken)
      throw new Error('mail observation truncated; cannot prove duplicate count');
    const result: ObservedMail[] = [];
    for (const item of list.messages ?? []) {
      const mail = await get<{
        id: string;
        threadId: string;
        labelIds?: string[];
        payload: GmailPart & { headers?: { name: string; value: string }[] };
      }>(`${base}/${encodeURIComponent(item.id)}?format=full`, tokens.accessToken);
      const header = (name: string) =>
        mail.payload.headers?.find((h) => h.name.toLowerCase() === name)?.value ?? '';
      const body = plain(mail.payload);
      if (!body.includes(`[live ${nonce}]`)) continue;
      const to = header('to')
        .split(',')
        .map((address) => (address.match(/<([^>]+)>/)?.[1] ?? address).trim());
      result.push({
        id: mail.id,
        subject: header('subject'),
        body,
        to,
        thread: mail.threadId,
        sent: mail.labelIds?.includes('SENT') ?? false,
        received: mail.labelIds?.includes('INBOX') ?? false,
      });
    }
    return result;
  }
  const result: ObservedMail[] = [];
  for (const folder of ['sentitems', 'inbox']) {
    const filter = encodeURIComponent(`contains(subject,'${project.replaceAll("'", "''")}')`);
    const list = await get<{
      value: {
        id: string;
        subject: string;
        body: { content: string };
        toRecipients: { emailAddress: { address: string } }[];
        conversationId: string;
      }[];
      '@odata.nextLink'?: string;
    }>(
      `https://graph.microsoft.com/v1.0/me/mailFolders/${folder}/messages?$filter=${filter}&$top=100&$select=id,subject,body,toRecipients,conversationId`,
      tokens.accessToken,
    );
    if (list['@odata.nextLink'])
      throw new Error('mail observation truncated; cannot prove duplicate count');
    for (const mail of list.value) {
      if (!mail.body.content.includes(`[live ${nonce}]`)) continue;
      result.push({
        id: mail.id,
        subject: mail.subject,
        body: mail.body.content,
        to: mail.toRecipients.map((recipient) => recipient.emailAddress.address),
        thread: mail.conversationId,
        sent: folder === 'sentitems',
        received: folder === 'inbox',
      });
    }
  }
  return result;
}
