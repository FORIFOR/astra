/**
 * connector を繋ぐ。正本 §21・§2.4。
 *
 * **値をサーバへ送らない**ことと、**片方だけ残さない**ことを見る。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { looksLikeCredential } from '@astra/contracts';
import { connectConnector, type ConnectorTarget } from '../src/settings/connect.js';
import { oauthCallback, secrets } from '../src/host/tauri.js';

const NOW = Date.parse('2026-08-27T12:00:00.000Z');

const target: ConnectorTarget = {
  pluginId: 'com.acme.mail',
  connectorId: 'gmail',
  provider: {
    provider: 'google',
    authorizeUrl: 'https://accounts.example.com/authorize',
    tokenUrl: 'https://oauth2.example.com/token',
    clientId: 'client-1',
    scopes: ['mail.read'],
  },
};

const kept = new Map<string, string>();

function stubHost(params: Record<string, string> = {}): { opened: string[] } {
  const opened: string[] = [];
  vi.spyOn(oauthCallback, 'listen').mockResolvedValue({
    redirectUri: 'http://127.0.0.1:53682/callback',
    port: 53682,
  });
  vi.spyOn(oauthCallback, 'await').mockImplementation(async () => {
    // 開いた URL の state を、そのまま返す（本物の提供者と同じ）
    const state = new URL(opened[0]!).searchParams.get('state')!;
    return { code: 'the-code', state, ...params };
  });
  vi.spyOn(oauthCallback, 'cancel').mockResolvedValue(undefined);
  vi.spyOn(secrets, 'set').mockImplementation(async (k, v) => void kept.set(k, v));
  vi.spyOn(secrets, 'get').mockImplementation(async (k) => kept.get(k) ?? null);
  vi.spyOn(secrets, 'delete').mockImplementation(async (k) => void kept.delete(k));
  return { opened };
}

afterEach(() => {
  vi.restoreAllMocks();
  kept.clear();
});

const tokenReply = () =>
  new Response(
    JSON.stringify({
      access_token: 'ya29.secret',
      refresh_token: 'r',
      expires_in: 3600,
      scope: 'mail.read',
    }),
    { headers: { 'content-type': 'application/json' } },
  );

describe('connecting', () => {
  it('sends a reference and never the token', async () => {
    const host = stubHost();
    const connect = vi.fn(async (_pluginId: string, _request: { credential_ref: string }) => undefined);
    const client = { connectConnector: connect } as never;

    const result = await connectConnector(target, {
      client,
      openExternal: async (url) => void host.opened.push(url),
      now: () => NOW,
      fetchImpl: (async () => tokenReply()) as never,
    });

    expect(connect).toHaveBeenCalledTimes(1);
    const sent = connect.mock.calls[0]![1];
    expect(sent.credential_ref).toBe('keychain:com.acme.mail/gmail');
    // 値そのものは、どこにも混ざっていない
    expect(JSON.stringify(connect.mock.calls[0])).not.toContain('ya29');
    expect(looksLikeCredential(sent.credential_ref)).toBe(false);
    // 値は端末の保管庫にだけある
    expect([...kept.values()].join()).toContain('ya29.secret');
    expect(result.grantedScopes).toEqual(['mail.read']);
  });

  it('opens the provider in the real browser, with the loopback it just bound', async () => {
    const host = stubHost();
    await connectConnector(target, {
      client: { connectConnector: async () => undefined } as never,
      openExternal: async (url) => void host.opened.push(url),
      now: () => NOW,
      fetchImpl: (async () => tokenReply()) as never,
    });

    const url = new URL(host.opened[0]!);
    expect(url.origin + url.pathname).toBe('https://accounts.example.com/authorize');
    expect(url.searchParams.get('redirect_uri')).toBe('http://127.0.0.1:53682/callback');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
  });
});

describe('when it does not finish', () => {
  it('closes the listener if the provider refuses', async () => {
    const host = stubHost({ error: 'access_denied' });
    const cancel = vi.spyOn(oauthCallback, 'cancel');

    await expect(
      connectConnector(target, {
        client: { connectConnector: async () => undefined } as never,
        openExternal: async (url) => void host.opened.push(url),
        now: () => NOW,
        fetchImpl: (async () => tokenReply()) as never,
      }),
    ).rejects.toThrow();
    // 開きっぱなしにしない
    expect(cancel).toHaveBeenCalled();
    // サーバへは何も渡っていない
    expect(kept.size).toBe(0);
  });

  it('does not keep a token the server refused to record', async () => {
    const host = stubHost();
    const client = {
      connectConnector: async () => {
        throw new Error('その scope は宣言されていません');
      },
    } as never;

    await expect(
      connectConnector(target, {
        client,
        openExternal: async (url) => void host.opened.push(url),
        now: () => NOW,
        fetchImpl: (async () => tokenReply()) as never,
      }),
    ).rejects.toThrow('宣言されていません');

    // 片方だけ残ると「繋がっていないのにトークンがある」状態になる
    expect(kept.size).toBe(0);
  });
});
