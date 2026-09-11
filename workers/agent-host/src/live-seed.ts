/**
 * DAILY_WORK_LIVE: 専用テスト identity に fixture を投入し、トークンを harness 用のファイルストアに置く。
 *
 *   ASTRA_LIVE_PROVIDER=google|microsoft ASTRA_SECRET_STORE_FILE=… \
 *   ASTRA_TEST_GOOGLE_CLIENT_ID=… ASTRA_TEST_GOOGLE_REFRESH_TOKEN=… （または ASTRA_TEST_MS_*）\
 *   pnpm exec tsx workers/agent-host/src/live-seed.ts <nonce> [--cleanup <seeded.json>]
 *
 * **本人のアカウントは触らない。**refresh token は事前に用意した専用 identity のもの。
 * 投入は provider の API そのもの（Gmail messages.insert / Calendar events.insert / Graph inbox messages / events）。
 * 同期と同じ経路は使わない — 同期が読む側で、こちらは書く側。書いた id は seeded.json に残し、終わったら消す。
 * 「これ返して」の送り先（sink）は既定で identity 自身（自分宛に返す）。`ASTRA_TEST_GMAIL_SINK` / `ASTRA_TEST_OUTLOOK_SINK` で変えられる。
 */
import { readFile, writeFile, rename } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { buildMime } from '@astra/service-connectors';
import { TokenStore } from '@astra/oauth';
import { observeReplies } from './live-receipt.js';
import { liveTokens, saveLiveReadGrant } from './live-oauth.js';
import { FileSecretStore } from './keychain.js';
import { liveFixture, type LiveFixture } from './live-fixture.js';

export interface Seeded {
  provider: 'google' | 'microsoft';
  fixture: LiveFixture;
  /** 自分（identity）のアドレス。返信の sink の既定。 */
  self: string;
  sink: string;
  messages: string[];
  events: string[];
}

const env = process.env;

async function json<T>(
  url: string,
  token: string,
  init: { method: string; body?: unknown; allowMissing?: boolean },
): Promise<T> {
  const res = await fetch(url, {
    method: init.method,
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
  });
  const text = await res.text();
  if (init.allowMissing && (res.status === 404 || res.status === 410)) return {} as T;
  if (!res.ok)
    throw new Error(`${init.method} ${url} → ${String(res.status)} ${text.slice(0, 300)}`);
  return (text ? JSON.parse(text) : {}) as T;
}

function rfc822(
  f: { subject: string; body: string; from: string },
  to: string,
  date: Date,
): string {
  const raw = `Date: ${date.toUTCString()}\r\nMessage-ID: <astra-fixture-${randomUUID()}@astra.invalid>\r\n${buildMime({ from: f.from, to: [to], subject: f.subject, body: f.body })}`;
  return Buffer.from(raw, 'utf8').toString('base64url');
}

export async function liveAccessToken(
  provider: 'google' | 'microsoft',
  scopes: string[],
): Promise<{ access: string; refreshToken: string }> {
  const tokens = await liveTokens(provider, scopes);
  return { access: tokens.accessToken, refreshToken: tokens.refreshToken! };
}

const GOOGLE_SEED_SCOPES = [
  'https://www.googleapis.com/auth/gmail.insert',
  'https://www.googleapis.com/auth/gmail.modify',
  'https://www.googleapis.com/auth/calendar.events',
];
const MICROSOFT_SEED_SCOPES = [
  'Mail.ReadWrite',
  'Calendars.ReadWrite',
  'User.Read',
  'offline_access',
];

export async function seedGoogle(
  f: LiveFixture,
  store: TokenStore,
  now: Date,
  checkpoint: (seeded: Seeded) => Promise<void>,
): Promise<Seeded> {
  const readTokens = await saveLiveReadGrant('google', store);
  const { access } = await liveAccessToken('google', GOOGLE_SEED_SCOPES);
  const me = await json<{ emailAddress: string }>(
    'https://gmail.googleapis.com/gmail/v1/users/me/profile',
    access,
    { method: 'GET' },
  );
  const reader = await json<{ emailAddress: string }>(
    'https://gmail.googleapis.com/gmail/v1/users/me/profile',
    readTokens.accessToken,
    { method: 'GET' },
  );
  if (reader.emailAddress.toLowerCase() !== me.emailAddress.toLowerCase())
    throw new Error('read and seed identities differ');
  const sink = env['ASTRA_TEST_GMAIL_SINK'] ?? me.emailAddress;
  if (sink.toLowerCase() !== me.emailAddress.toLowerCase())
    throw new Error('live receipt requires self sink');
  const messages: string[] = [];
  const seeded: Seeded = {
    provider: 'google',
    fixture: f,
    self: me.emailAddress,
    sink,
    messages,
    events: [],
  };
  await checkpoint(seeded);
  // Mail A は会議の前（2 日前）、Mail B は会議のあと（いま）。返信先（From）は sink。
  for (const [mail, date] of [
    [{ ...f.mailA, from: sink }, new Date(now.getTime() - 2 * 86_400_000)],
    [{ ...f.mailB, from: sink }, now],
  ] as const) {
    const inserted = await json<{ id: string }>(
      'https://gmail.googleapis.com/gmail/v1/users/me/messages?internalDateSource=dateHeader',
      access,
      {
        method: 'POST',
        body: { raw: rfc822(mail, me.emailAddress, date), labelIds: ['INBOX', 'UNREAD'] },
      },
    );
    messages.push(inserted.id);
    await checkpoint(seeded);
  }
  const event = await json<{ id: string }>(
    'https://www.googleapis.com/calendar/v3/calendars/primary/events',
    access,
    {
      method: 'POST',
      body: {
        summary: f.meeting2.subject,
        start: { dateTime: f.meeting2.startIso },
        end: { dateTime: f.meeting2.endIso },
      },
    },
  );
  seeded.events.push(event.id);
  await checkpoint(seeded);
  return seeded;
}

export async function seedMicrosoft(
  f: LiveFixture,
  store: TokenStore,
  _now: Date,
  checkpoint: (seeded: Seeded) => Promise<void>,
): Promise<Seeded> {
  const readTokens = await saveLiveReadGrant('microsoft', store);
  const { access } = await liveAccessToken('microsoft', MICROSOFT_SEED_SCOPES);
  const base = 'https://graph.microsoft.com/v1.0';
  const me = await json<{ mail?: string; userPrincipalName: string }>(`${base}/me`, access, {
    method: 'GET',
  });
  const self = me.mail ?? me.userPrincipalName;
  const reader = await json<{ mail?: string; userPrincipalName: string }>(
    `${base}/me`,
    readTokens.accessToken,
    { method: 'GET' },
  );
  if ((reader.mail ?? reader.userPrincipalName).toLowerCase() !== self.toLowerCase())
    throw new Error('read and seed identities differ');
  const sink = env['ASTRA_TEST_OUTLOOK_SINK'] ?? self;
  if (sink.toLowerCase() !== self.toLowerCase()) throw new Error('live receipt requires self sink');
  const messages: string[] = [];
  const seeded: Seeded = { provider: 'microsoft', fixture: f, self, sink, messages, events: [] };
  await checkpoint(seeded);
  for (const mail of [f.mailA, f.mailB]) {
    const created = await json<{ id: string; isDraft?: boolean }>(
      `${base}/me/mailFolders/inbox/messages`,
      access,
      {
        method: 'POST',
        body: {
          subject: mail.subject,
          body: { contentType: 'text', content: mail.body },
          from: { emailAddress: { address: sink, name: 'ACME' } },
          toRecipients: [{ emailAddress: { address: self } }],
          isRead: false,
          // Import a received fixture, never send a setup email. MSGFLAG_UNSENT
          // can be set on initial save (PidTagMessageFlags); still verify Graph's
          // returned isDraft state instead of assuming the extended property worked.
          // https://learn.microsoft.com/en-us/office/client-developer/outlook/mapi/pidtagmessageflags-canonical-property
          singleValueExtendedProperties: [{ id: 'Integer 0x0E07', value: '0' }],
        },
      },
    );
    messages.push(created.id);
    await checkpoint(seeded);
    if (created.isDraft !== false)
      throw new Error('Microsoft seed is not a verified received message; retain IDs for cleanup');
  }
  const event = await json<{ id: string }>(`${base}/me/events`, access, {
    method: 'POST',
    body: {
      subject: f.meeting2.subject,
      start: { dateTime: f.meeting2.startIso, timeZone: 'UTC' },
      end: { dateTime: f.meeting2.endIso, timeZone: 'UTC' },
    },
  });
  seeded.events.push(event.id);
  await checkpoint(seeded);
  return seeded;
}

export async function cleanup(seeded: Seeded): Promise<void> {
  const errors: unknown[] = [];
  const collect = (error: unknown) => {
    errors.push(error);
  };
  if (seeded.provider === 'google') {
    const { access } = await liveAccessToken('google', GOOGLE_SEED_SCOPES);
    for (const id of seeded.messages)
      await json(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}/trash`, access, {
        method: 'POST',
        allowMissing: true,
      }).catch(collect);
    for (const id of seeded.events)
      await json(`https://www.googleapis.com/calendar/v3/calendars/primary/events/${id}`, access, {
        method: 'DELETE',
        allowMissing: true,
      }).catch(collect);
  } else {
    const { access } = await liveAccessToken('microsoft', MICROSOFT_SEED_SCOPES);
    const base = 'https://graph.microsoft.com/v1.0';
    for (const id of seeded.messages)
      await json(`${base}/me/messages/${id}`, access, {
        method: 'DELETE',
        allowMissing: true,
      }).catch(collect);
    for (const id of seeded.events)
      await json(`${base}/me/events/${id}`, access, { method: 'DELETE', allowMissing: true }).catch(
        collect,
      );
  }
  if (errors.length)
    throw new AggregateError(
      errors,
      `fixture cleanup failed for ${errors.length} resource(s); retain seeded.json for retry`,
    );
}

async function main(): Promise<void> {
  const [nonce, flag, file] = process.argv.slice(2);
  if (flag === '--cleanup' && file) {
    const seeded = JSON.parse(await readFile(file, 'utf8')) as Seeded;
    const errors: unknown[] = [];
    try {
      // Also covers accepted sends whose response was lost or whose task failed.
      const effects = await observeReplies(
        seeded.provider,
        seeded.fixture.nonce,
        seeded.fixture.project,
      );
      seeded.messages = [...new Set([...seeded.messages, ...effects.map((mail) => mail.id)])];
      await writeFile(`${file}.tmp`, JSON.stringify(seeded, null, 2), { mode: 0o600 });
      await rename(`${file}.tmp`, file);
    } catch (error) {
      errors.push(error);
    }
    try {
      await cleanup(seeded);
    } catch (error) {
      errors.push(error);
    }
    if (errors.length)
      throw new AggregateError(errors, 'cleanup or sent-effect reconciliation incomplete');
    console.log('LIVE_SEED cleaned');
    return;
  }
  if (!nonce) throw new Error('usage: live-seed.ts <nonce> [--cleanup seeded.json]');
  const provider = env['ASTRA_LIVE_PROVIDER'] === 'microsoft' ? 'microsoft' : 'google';
  const storePath = env['ASTRA_SECRET_STORE_FILE'];
  if (!storePath) throw new Error('ASTRA_SECRET_STORE_FILE is required (never the login keychain)');
  const store = new TokenStore(new FileSecretStore(storePath));
  const now = new Date();
  const fixture = liveFixture(now, nonce);
  const out = env['ASTRA_LIVE_SEEDED_FILE'] ?? 'seeded.json';
  const checkpoint = async (value: Seeded) => {
    await writeFile(`${out}.tmp`, JSON.stringify(value, null, 2), { mode: 0o600 });
    await rename(`${out}.tmp`, out);
  };
  const seeded =
    provider === 'google'
      ? await seedGoogle(fixture, store, now, checkpoint)
      : await seedMicrosoft(fixture, store, now, checkpoint);
  await checkpoint(seeded);
  console.log(`LIVE_SEED ok provider=${provider} sink=${seeded.sink} → ${out}`);
}

if (process.argv[1]?.endsWith('live-seed.ts') || process.argv[1]?.endsWith('live-seed.js')) {
  main().catch((error: unknown) => {
    console.error(`LIVE_SEED=FAIL ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  });
}
