/**
 * WORK_CONTEXT_LIVE_GATE: 専用テスト identity に fixture を投入し、トークンを harness 用のファイルストアに置く。
 *
 *   ASTRA_SECRET_STORE_FILE=… ASTRA_TEST_GOOGLE_CLIENT_ID=… ASTRA_TEST_GOOGLE_REFRESH_TOKEN=… \
 *   ASTRA_TEST_MICROSOFT_CLIENT_ID=… ASTRA_TEST_MICROSOFT_REFRESH_TOKEN=… \
 *   pnpm exec tsx workers/agent-host/src/live-seed.ts <nonce> [--cleanup <seeded.json>]
 *
 * **本人のアカウントは触らない。**refresh token は事前に用意した専用 identity のもの。
 * 投入は provider の API そのもの（Gmail messages.insert / Calendar events.insert /
 * Graph inbox messages / events / todo tasks）。同期と同じ経路は使わない — 同期が読む側で、
 * こちらは書く側。書いた id は seeded.json に残し、終わったら消す。
 */
import { readFile, writeFile } from 'node:fs/promises';
import { providerConfig, refresh, TokenStore } from '@astra/oauth';
import { FileSecretStore } from './keychain.js';
import { liveFixture, type LiveFixture } from './live-fixture.js';

interface Seeded {
  google?: { messages: string[]; events: string[] };
  microsoft?: { messages: string[]; events: string[]; tasks: { listId: string; id: string }[] };
}

const env = process.env;

async function json<T>(
  url: string,
  token: string,
  init: { method: string; body?: unknown },
): Promise<T> {
  const res = await fetch(url, {
    method: init.method,
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
  });
  const text = await res.text();
  if (!res.ok)
    throw new Error(`${init.method} ${url} → ${String(res.status)} ${text.slice(0, 300)}`);
  return (text ? JSON.parse(text) : {}) as T;
}

function rfc822(f: { subject: string; body: string; from: string }, to: string): string {
  const raw = [
    `From: ${f.from}`,
    `To: ${to}`,
    `Subject: ${f.subject}`,
    'Content-Type: text/plain; charset=UTF-8',
    '',
    f.body,
  ].join('\r\n');
  return Buffer.from(raw, 'utf8').toString('base64url');
}

async function accessToken(
  provider: 'google' | 'microsoft',
  scopes: string[],
): Promise<{ access: string; refreshToken: string }> {
  const upper = provider.toUpperCase();
  const clientId = env[`ASTRA_TEST_${upper}_CLIENT_ID`];
  const refreshToken = env[`ASTRA_TEST_${upper}_REFRESH_TOKEN`];
  if (!clientId || !refreshToken) throw new Error(`${provider}: test identity not provisioned`);
  const config = providerConfig(provider, scopes, { [`ASTRA_OAUTH_${upper}_CLIENT_ID`]: clientId });
  if (!config) throw new Error(`${provider}: no provider config`);
  const tokens = await refresh(
    { ...config, redirectUri: 'http://127.0.0.1:0/callback' },
    refreshToken,
    fetch,
  );
  return { access: tokens.accessToken, refreshToken };
}

async function seedGoogle(
  f: LiveFixture,
  store: TokenStore,
): Promise<NonNullable<Seeded['google']>> {
  const seedScopes = [
    'https://www.googleapis.com/auth/gmail.insert',
    'https://www.googleapis.com/auth/gmail.readonly',
    'https://www.googleapis.com/auth/calendar.events',
  ];
  const { access, refreshToken } = await accessToken('google', seedScopes);
  const me = await json<{ emailAddress: string }>(
    'https://gmail.googleapis.com/gmail/v1/users/me/profile',
    access,
    { method: 'GET' },
  );
  const messages: string[] = [];
  for (const mail of [f.mailA, f.mailB]) {
    const inserted = await json<{ id: string }>(
      'https://gmail.googleapis.com/gmail/v1/users/me/messages?internalDateSource=receivedTime',
      access,
      {
        method: 'POST',
        body: { raw: rfc822(mail, me.emailAddress), labelIds: ['INBOX', 'UNREAD'] },
      },
    );
    messages.push(inserted.id);
  }
  const event = await json<{ id: string }>(
    'https://www.googleapis.com/calendar/v3/calendars/primary/events',
    access,
    {
      method: 'POST',
      body: {
        summary: f.meeting.subject,
        start: { dateTime: f.meeting.startIso },
        end: { dateTime: f.meeting.endIso },
      },
    },
  );
  // 同期が読む側のトークン（読む接続だけ）。値はファイルストアにだけ置く。
  const readOnly = {
    accessToken: access,
    refreshToken,
    expiresAt: null,
    grantedScopes: seedScopes,
    tokenType: 'Bearer',
    idToken: null,
  };
  await store.save('com.astra.gmail', 'gmail', readOnly);
  await store.save('com.astra.google-calendar', 'google-calendar', readOnly);
  return { messages, events: [event.id] };
}

async function seedMicrosoft(
  f: LiveFixture,
  store: TokenStore,
): Promise<NonNullable<Seeded['microsoft']>> {
  const seedScopes = ['Mail.ReadWrite', 'Calendars.ReadWrite', 'Tasks.ReadWrite', 'offline_access'];
  const { access, refreshToken } = await accessToken('microsoft', seedScopes);
  const base = 'https://graph.microsoft.com/v1.0';
  const messages: string[] = [];
  for (const mail of [f.mailA, f.mailB]) {
    const created = await json<{ id: string }>(`${base}/me/mailFolders/inbox/messages`, access, {
      method: 'POST',
      body: {
        subject: mail.subject,
        body: { contentType: 'text', content: mail.body },
        from: { emailAddress: { address: mail.from, name: 'Example Client' } },
        isRead: false,
      },
    });
    messages.push(created.id);
  }
  const event = await json<{ id: string }>(`${base}/me/events`, access, {
    method: 'POST',
    body: {
      subject: f.meeting.subject,
      start: { dateTime: f.meeting.startIso, timeZone: 'UTC' },
      end: { dateTime: f.meeting.endIso, timeZone: 'UTC' },
    },
  });
  const lists = await json<{ value: { id: string; displayName: string }[] }>(
    `${base}/me/todo/lists`,
    access,
    { method: 'GET' },
  );
  const list = lists.value[0];
  if (!list) throw new Error('microsoft: no To Do list');
  const task = await json<{ id: string }>(`${base}/me/todo/lists/${list.id}/tasks`, access, {
    method: 'POST',
    body: {
      title: f.task.title,
      dueDateTime: { dateTime: f.task.dueIso.replace('Z', ''), timeZone: 'UTC' },
      importance: 'high',
    },
  });
  const readOnly = {
    accessToken: access,
    refreshToken,
    expiresAt: null,
    grantedScopes: seedScopes,
    tokenType: 'Bearer',
    idToken: null,
  };
  await store.save('com.astra.outlook', 'outlook', readOnly);
  await store.save('com.astra.microsoft-todo', 'microsoft-todo', readOnly);
  return { messages, events: [event.id], tasks: [{ listId: list.id, id: task.id }] };
}

async function cleanup(seeded: Seeded): Promise<void> {
  if (seeded.google) {
    const { access } = await accessToken('google', [
      'https://www.googleapis.com/auth/gmail.modify',
      'https://www.googleapis.com/auth/calendar.events',
    ]);
    for (const id of seeded.google.messages)
      await json(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}/trash`, access, {
        method: 'POST',
      }).catch(() => undefined);
    for (const id of seeded.google.events)
      await json(`https://www.googleapis.com/calendar/v3/calendars/primary/events/${id}`, access, {
        method: 'DELETE',
      }).catch(() => undefined);
  }
  if (seeded.microsoft) {
    const { access } = await accessToken('microsoft', [
      'Mail.ReadWrite',
      'Calendars.ReadWrite',
      'Tasks.ReadWrite',
      'offline_access',
    ]);
    const base = 'https://graph.microsoft.com/v1.0';
    for (const id of seeded.microsoft.messages)
      await json(`${base}/me/messages/${id}`, access, { method: 'DELETE' }).catch(() => undefined);
    for (const id of seeded.microsoft.events)
      await json(`${base}/me/events/${id}`, access, { method: 'DELETE' }).catch(() => undefined);
    for (const t of seeded.microsoft.tasks)
      await json(`${base}/me/todo/lists/${t.listId}/tasks/${t.id}`, access, {
        method: 'DELETE',
      }).catch(() => undefined);
  }
}

async function main(): Promise<void> {
  const [nonce, flag, file] = process.argv.slice(2);
  if (flag === '--cleanup' && file) {
    await cleanup(JSON.parse(await readFile(file, 'utf8')) as Seeded);
    console.log('LIVE_SEED cleaned');
    return;
  }
  if (!nonce) throw new Error('usage: live-seed.ts <nonce> [--cleanup seeded.json]');
  const storePath = env['ASTRA_SECRET_STORE_FILE'];
  if (!storePath) throw new Error('ASTRA_SECRET_STORE_FILE is required (never the login keychain)');
  const store = new TokenStore(new FileSecretStore(storePath));
  const fixture = liveFixture(new Date(), nonce);
  const seeded: Seeded = {};
  const providers: string[] = [];
  if (env['ASTRA_TEST_GOOGLE_REFRESH_TOKEN']) {
    seeded.google = await seedGoogle(fixture, store);
    providers.push('google');
  }
  if (env['ASTRA_TEST_MICROSOFT_REFRESH_TOKEN']) {
    seeded.microsoft = await seedMicrosoft(fixture, store);
    providers.push('microsoft');
  }
  if (providers.length === 0) throw new Error('no test identity provisioned');
  const out = env['ASTRA_LIVE_SEEDED_FILE'] ?? 'seeded.json';
  await writeFile(out, JSON.stringify({ ...seeded, fixture }, null, 2));
  console.log(`LIVE_SEED ok providers=${providers.join(',')} → ${out}`);
}

main().catch((error: unknown) => {
  console.error(`LIVE_SEED=FAIL ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
