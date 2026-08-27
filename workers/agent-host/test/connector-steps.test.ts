/**
 * 端末で connector を走らせる部分。正本 §2.4・§21。
 *
 * ここが**トークンが存在する唯一の場所**なので、見るのは:
 *   - 鍵が外へ出ないこと
 *   - 承認の無い送信・削除が実行されないこと
 *   - 失敗が理由つきで返ること
 */
import { describe, expect, it, vi } from 'vitest';
import type { SecretStore } from '@astra/oauth';
import { ConnectorRuntime } from '../src/connector-steps.js';
import type { HostStep } from '../src/connector-steps.js';

const ACCESS = 'ya29.test-access-token';

function memoryStore(initial: Record<string, string> = {}): SecretStore & {
  values: Record<string, string>;
} {
  const values = { ...initial };
  return {
    values,
    async get(key) {
      return values[key] ?? null;
    },
    async set(key, value) {
      values[key] = value;
    },
    async delete(key) {
      delete values[key];
    },
  };
}

const connected = (over: Record<string, unknown> = {}): Record<string, string> => ({
  'com.astra.gmail/gmail': JSON.stringify({
    accessToken: ACCESS,
    refreshToken: 'refresh-1',
    scopes: [],
    expiresAt: '2099-01-01T00:00:00.000Z',
    ...over,
  }),
  'com.astra.google-calendar/google-calendar': JSON.stringify({
    accessToken: ACCESS,
    refreshToken: 'refresh-1',
    scopes: [],
    expiresAt: '2099-01-01T00:00:00.000Z',
  }),
});

interface Sent {
  url: string;
  authorization: string | undefined;
  body: unknown;
}

function runtime(
  secrets: SecretStore,
  scopes: readonly string[] = ['email.read', 'email.draft', 'email.modify', 'email.send'],
): { runtime: ConnectorRuntime; sent: Sent[] } {
  const sent: Sent[] = [];
  const fetch = (async (url: string, init: RequestInit) => {
    const headers = init.headers as Record<string, string>;
    sent.push({
      url,
      authorization: headers?.['authorization'],
      body: init.body ? JSON.parse(init.body as string) : undefined,
    });
    return new Response(JSON.stringify({ id: 'm1', threadId: 't1' }), { status: 200 });
  }) as unknown as typeof globalThis.fetch;

  return {
    sent,
    runtime: new ConnectorRuntime({
      secrets,
      credentialRefFor: (pluginId, connectorId) => `keychain:${pluginId}/${connectorId}`,
      grantedScopes: (pluginId) =>
        pluginId === 'com.astra.gmail' ? scopes : ['calendar.read', 'calendar.write'],
      fetch,
      now: () => new Date('2026-08-27T00:00:00.000Z'),
    }),
  };
}

const step = (over: Partial<HostStep> = {}): HostStep => ({
  id: 'req-1',
  toolId: 'mail.send',
  args: { to: ['a@example.com'], subject: 's', body: 'b' },
  approval: null,
  ...over,
});

const approved = (operationId: string): HostStep['approval'] => ({
  approvalId: 'ap-1',
  operationId,
  decision: 'APPROVED',
  decidedBy: 'user-1',
  decidedAt: '2026-08-26T23:59:00.000Z',
  expiresAt: '2026-08-27T00:05:00.000Z',
});

describe('running a connector step on the device', () => {
  it('only takes the steps this device can run', () => {
    const { runtime: r } = runtime(memoryStore(connected()));
    expect(r.handles('mail.send')).toBe(true);
    expect(r.handles('calendar.create_event')).toBe(true);
    expect(r.handles('crm.write')).toBe(false);
  });

  it('will not send without the approval that the cloud granted', async () => {
    const { runtime: r, sent } = runtime(memoryStore(connected()));
    const outcome = await r.run(step());

    expect(outcome.ok).toBe(false);
    expect(outcome.error!.code).toBe('connector.approval_required');
    // 確かめる前に一度も外へ出していない
    expect(sent).toEqual([]);
  });

  it('sends once the approval travelled with the step', async () => {
    const { runtime: r, sent } = runtime(memoryStore(connected()));
    const outcome = await r.run(step({ approval: approved('gmail.send') }));

    expect(outcome.ok).toBe(true);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.url).toContain('/messages/send');
  });

  it('will not trash without approval either', async () => {
    const { runtime: r, sent } = runtime(memoryStore(connected()));
    const outcome = await r.run(
      step({ toolId: 'mail.trash', args: { message_id: 'm1' }, approval: null }),
    );
    expect(outcome.error!.code).toBe('connector.approval_required');
    expect(sent).toEqual([]);
  });

  it('drafts without asking anyone, because a draft is not sent', async () => {
    const { runtime: r, sent } = runtime(memoryStore(connected()));
    const outcome = await r.run(step({ toolId: 'mail.draft.create' }));
    expect(outcome.ok).toBe(true);
    expect(sent[0]!.url).toContain('/drafts');
  });

  it('reads the token at call time and sends it only to the provider', async () => {
    const store = memoryStore(connected());
    const { runtime: r, sent } = runtime(store);
    await r.run(step({ approval: approved('gmail.send') }));

    expect(sent[0]!.authorization).toBe(`Bearer ${ACCESS}`);
    // 端末の外へ出るのは提供者への 1 本だけ
    expect(sent).toHaveLength(1);
    expect(sent[0]!.url.startsWith('https://gmail.googleapis.com/')).toBe(true);
  });

  it('says it is not connected rather than failing at the provider', async () => {
    const { runtime: r, sent } = runtime(memoryStore());
    const outcome = await r.run(step({ approval: approved('gmail.send') }));

    expect(outcome.error!.code).toBe('connector.not_connected');
    expect(outcome.error!.message).toContain('接続');
    expect(sent).toEqual([]);
  });

  it('asks to be connected again when the token expired and cannot be renewed', async () => {
    const store = memoryStore({
      'com.astra.gmail/gmail': JSON.stringify({
        accessToken: ACCESS,
        refreshToken: null,
        scopes: [],
        expiresAt: '2026-08-26T00:00:00.000Z',
      }),
    });
    const { runtime: r } = runtime(store);
    const outcome = await r.run(step({ approval: approved('gmail.send') }));
    expect(outcome.error!.code).toBe('connector.token_expired');
  });

  it('refuses a step whose scope was never granted, before touching the network', async () => {
    const { runtime: r, sent } = runtime(memoryStore(connected()), ['email.read']);
    const outcome = await r.run(step({ approval: approved('gmail.send') }));

    expect(outcome.error!.code).toBe('connector.insufficient_scope');
    expect(sent).toEqual([]);
  });

  it('does not quietly succeed on a step it does not know', async () => {
    const { runtime: r } = runtime(memoryStore(connected()));
    const outcome = await r.run(step({ toolId: 'mail.archive' }));
    expect(outcome.ok).toBe(false);
    expect(outcome.error!.code).toBe('connector.not_found');
  });

  it('reads an all-day calendar event as a date, not a time', async () => {
    const store = memoryStore(connected());
    const sent: Sent[] = [];
    const fetch = (async (url: string, init: RequestInit) => {
      sent.push({
        url,
        authorization: undefined,
        body: init.body ? JSON.parse(init.body as string) : undefined,
      });
      return new Response(JSON.stringify({ id: 'e1', status: 'confirmed' }), { status: 200 });
    }) as unknown as typeof globalThis.fetch;

    const r = new ConnectorRuntime({
      secrets: store,
      credentialRefFor: (p, c) => `keychain:${p}/${c}`,
      grantedScopes: () => ['calendar.read', 'calendar.write'],
      fetch,
      now: () => new Date('2026-08-27T00:00:00.000Z'),
    });

    await r.run(
      step({
        toolId: 'calendar.create_event',
        args: { title: '休暇', start: '2026-09-01', end: '2026-09-02' },
        approval: approved('calendar.create'),
      }),
    );

    expect(sent[0]!.body).toMatchObject({ start: { date: '2026-09-01' } });
  });

  it('never writes the token into what it returns', async () => {
    const { runtime: r } = runtime(memoryStore(connected()));
    const outcome = await r.run(step({ approval: approved('gmail.send') }));
    expect(JSON.stringify(outcome)).not.toContain(ACCESS);
  });
});
