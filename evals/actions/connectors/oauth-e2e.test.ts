/**
 * OAuth を、実際の HTTP で通す。正本 §21、RFC 8252 / RFC 7636。
 *
 * **本物の認可サーバは立てられない**（Google の client は人が作る）ので、
 * 代わりに**仕様どおりに振る舞う認可サーバをここで立てて**、
 * 端末側の実装を丸ごと通す。
 *
 * 偽の fetch を差し込む単体試験では見えないものを見る:
 *   - loopback で本当に受け取れるか
 *   - PKCE の verifier が本当に検証されるか（**間違っていれば断られるか**）
 *   - 交換した token が保管庫に入り、読み戻せるか
 *   - 期限が切れたとき、更新して**続けられる**か
 *   - 取り消されたとき、**繋ぎ直しを促せる**か
 *
 * ここで verified になるのは**実装**であって、Google 上の接続ではない。
 * 実アカウントの疎通は client を作ってからで、そこは別に記録する。
 */
import { createHash, randomUUID } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  acceptCallback,
  beginAuthorization,
  credentialRef,
  exchangeCode,
  needsRefresh,
  refresh,
  TokenStore,
  type ProviderConfig,
  type SecretStore,
} from '@astra/oauth';
import { looksLikeCredential } from '@astra/contracts';

/** 仕様どおりに振る舞う、その場限りの認可サーバ。 */
interface FakeProvider {
  readonly origin: string;
  /** 発行済みのコード → その要求の PKCE challenge。 */
  readonly codes: Map<string, { challenge: string; redirectUri: string }>;
  /** 生きている refresh token。取り消すとここから消える。 */
  readonly refreshTokens: Set<string>;
  close(): Promise<void>;
}

async function startProvider(): Promise<FakeProvider> {
  const codes = new Map<string, { challenge: string; redirectUri: string }>();
  const refreshTokens = new Set<string>();
  let issued = 0;

  const server: Server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1');

    // --- 同意画面のかわり。承諾したことにして折り返す。
    if (url.pathname === '/authorize') {
      const challenge = url.searchParams.get('code_challenge') ?? '';
      const method = url.searchParams.get('code_challenge_method');
      const redirectUri = url.searchParams.get('redirect_uri') ?? '';
      const state = url.searchParams.get('state') ?? '';

      // **plain を受け付けない。**受け付けると PKCE の意味が消える。
      if (method !== 'S256' || challenge.length === 0) {
        response.writeHead(400).end('code_challenge_method must be S256');
        return;
      }
      const code = `code-${String((issued += 1))}`;
      codes.set(code, { challenge, redirectUri });

      const back = new URL(redirectUri);
      back.searchParams.set('code', code);
      back.searchParams.set('state', state);
      response.writeHead(302, { location: back.toString() }).end();
      return;
    }

    // --- token endpoint
    if (url.pathname === '/token' && request.method === 'POST') {
      let body = '';
      request.on('data', (chunk) => (body += String(chunk)));
      request.on('end', () => {
        const form = new URLSearchParams(body);
        const json = (status: number, value: unknown): void => {
          response.writeHead(status, { 'content-type': 'application/json' });
          response.end(JSON.stringify(value));
        };

        if (form.get('grant_type') === 'authorization_code') {
          const record = codes.get(form.get('code') ?? '');
          if (!record) return json(400, { error: 'invalid_grant' });
          // **一度きり。**使い回せると、盗まれたコードが何度でも通る。
          codes.delete(form.get('code') ?? '');

          const verifier = form.get('code_verifier') ?? '';
          const computed = createHash('sha256').update(verifier).digest('base64url');
          if (computed !== record.challenge) {
            return json(400, { error: 'invalid_grant', error_description: 'PKCE mismatch' });
          }
          const token = `refresh-${randomUUID()}`;
          refreshTokens.add(token);
          return json(200, {
            access_token: `access-${randomUUID()}`,
            refresh_token: token,
            expires_in: 3600,
            // **要求したものより狭い。**同意画面で外された状況を再現する。
            scope: 'https://www.googleapis.com/auth/gmail.readonly',
          });
        }

        if (form.get('grant_type') === 'refresh_token') {
          const token = form.get('refresh_token') ?? '';
          if (!refreshTokens.has(token)) {
            // 取り消し済み。**新しい access token を出さない。**
            return json(400, { error: 'invalid_grant', error_description: 'token revoked' });
          }
          return json(200, {
            access_token: `access-${randomUUID()}`,
            expires_in: 3600,
            scope: 'https://www.googleapis.com/auth/gmail.readonly',
          });
        }
        return json(400, { error: 'unsupported_grant_type' });
      });
      return;
    }
    response.writeHead(404).end();
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;

  return {
    origin: `http://127.0.0.1:${String(port)}`,
    codes,
    refreshTokens,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
      }),
  };
}

/** 端末の保管庫のかわり。**値はここから出さない。** */
function memoryStore(): SecretStore & { readonly values: Map<string, string> } {
  const values = new Map<string, string>();
  return {
    values,
    async get(key) {
      return values.get(key) ?? null;
    },
    async set(key, value) {
      values.set(key, value);
    },
    async delete(key) {
      values.delete(key);
    },
  };
}

describe('signing in, all the way through real HTTP', () => {
  let provider: FakeProvider;
  let loopback: Server;
  let redirectUri = '';
  /** loopback が受け取った折り返し。 */
  let received: URLSearchParams | null = null;

  const configFor = (): ProviderConfig => ({
    provider: 'google',
    authorizeUrl: `${provider.origin}/authorize`,
    tokenUrl: `${provider.origin}/token`,
    clientId: 'test-desktop-client',
    scopes: [
      'https://www.googleapis.com/auth/gmail.readonly',
      'https://www.googleapis.com/auth/gmail.send',
    ],
    redirectUri,
  });

  beforeAll(async () => {
    provider = await startProvider();

    // 端末側の loopback listener（Tauri の oauth.rs にあたるもの）
    loopback = createServer((request, response) => {
      received = new URL(request.url ?? '/', 'http://127.0.0.1').searchParams;
      response.writeHead(200, { 'content-type': 'text/plain' }).end('done');
    });
    await new Promise<void>((resolve) => loopback.listen(0, '127.0.0.1', resolve));
    redirectUri = `http://127.0.0.1:${String((loopback.address() as AddressInfo).port)}/callback`;
  }, 60_000);

  afterAll(async () => {
    await provider?.close();
    await new Promise<void>((resolve) => loopback?.close(() => resolve()));
  });

  /** 同意画面を人が通したことにして、折り返しまで進める。 */
  const consent = async (url: string): Promise<URLSearchParams> => {
    received = null;
    // redirect を追う = 折り返しが loopback に届く
    await fetch(url, { redirect: 'follow' });
    if (!received) throw new Error('the loopback never received the callback');
    return received;
  };

  it('carries the sign-in from the browser back to this device', async () => {
    const { url, pending } = await beginAuthorization(configFor());
    expect(url.startsWith(`${provider.origin}/authorize`)).toBe(true);
    // **challenge を送り、verifier は送らない**（RFC 7636）
    expect(new URL(url).searchParams.get('code_challenge_method')).toBe('S256');
    expect(url).not.toContain(pending.pkce.verifier);

    const params = await consent(url);
    const { code } = acceptCallback(pending, {
      code: params.get('code') ?? undefined,
      state: params.get('state') ?? undefined,
    });

    const tokens = await exchangeCode(pending, code, fetch);
    expect(tokens.accessToken.startsWith('access-')).toBe(true);
    expect(tokens.refreshToken).not.toBeNull();
    expect(tokens.expiresAt).not.toBeNull();
  }, 60_000);

  it('records only what the provider actually granted', async () => {
    const { url, pending } = await beginAuthorization(configFor());
    const params = await consent(url);
    const { code } = acceptCallback(pending, {
      code: params.get('code') ?? undefined,
      state: params.get('state') ?? undefined,
    });
    const tokens = await exchangeCode(pending, code, fetch);

    /*
     * 2 つ要求したが、同意画面で 1 つ外された。
     * **要求した側を記録すると、許していない操作を許したことになる。**
     */
    expect(tokens.grantedScopes).toEqual(['https://www.googleapis.com/auth/gmail.readonly']);
  }, 60_000);

  it('is refused when the verifier does not match the challenge', async () => {
    const { url, pending } = await beginAuthorization(configFor());
    const params = await consent(url);
    const { code } = acceptCallback(pending, {
      code: params.get('code') ?? undefined,
      state: params.get('state') ?? undefined,
    });

    // 盗んだコードを、別の窓の verifier で使おうとする
    const other = await beginAuthorization(configFor());
    await expect(exchangeCode(other.pending, code, fetch)).rejects.toThrow();
  }, 60_000);

  it('will not let the same code be used twice', async () => {
    const { url, pending } = await beginAuthorization(configFor());
    const params = await consent(url);
    const { code } = acceptCallback(pending, {
      code: params.get('code') ?? undefined,
      state: params.get('state') ?? undefined,
    });

    await exchangeCode(pending, code, fetch);
    // 二度目は通らない。通ると、盗まれたコードが何度でも使える。
    await expect(exchangeCode(pending, code, fetch)).rejects.toThrow();
  }, 60_000);

  it('refuses a callback meant for a different sign-in', async () => {
    const first = await beginAuthorization(configFor());
    const params = await consent(first.url);
    const second = await beginAuthorization(configFor());

    // 他人が仕込んだコードを、本人のものとして受け取らない（CSRF）
    expect(() =>
      acceptCallback(second.pending, {
        code: params.get('code') ?? undefined,
        state: params.get('state') ?? undefined,
      }),
    ).toThrow();
  }, 60_000);

  it('keeps the token on this device and hands out only a reference', async () => {
    const secrets = memoryStore();
    const store = new TokenStore(secrets);

    const { url, pending } = await beginAuthorization(configFor());
    const params = await consent(url);
    const { code } = acceptCallback(pending, {
      code: params.get('code') ?? undefined,
      state: params.get('state') ?? undefined,
    });
    const tokens = await exchangeCode(pending, code, fetch);

    const ref = await store.save('com.astra.gmail', 'gmail', tokens);

    // **サーバへ渡るのは参照だけ。**値は保管庫の中にしかない。
    expect(ref).toBe(credentialRef('com.astra.gmail', 'gmail'));
    expect(looksLikeCredential(ref)).toBe(false);
    expect(ref).not.toContain(tokens.accessToken);
    expect([...secrets.values.values()].join()).toContain(tokens.accessToken);

    const read = await store.load(ref);
    expect(read?.accessToken).toBe(tokens.accessToken);
  }, 60_000);

  it('renews itself before the token runs out', async () => {
    const { url, pending } = await beginAuthorization(configFor());
    const params = await consent(url);
    const { code } = acceptCallback(pending, {
      code: params.get('code') ?? undefined,
      state: params.get('state') ?? undefined,
    });
    const tokens = await exchangeCode(pending, code, fetch);

    const nearlyExpired = Date.parse(tokens.expiresAt!) - 30_000;
    expect(needsRefresh(tokens, nearlyExpired)).toBe(true);

    const renewed = await refresh(configFor(), tokens.refreshToken!, fetch);
    expect(renewed.accessToken).not.toBe(tokens.accessToken);
    // 更新の応答が refresh token を返さなくても、失わない
    expect(renewed.refreshToken).toBe(tokens.refreshToken);
  }, 60_000);

  it('asks to be connected again once access is taken away', async () => {
    const { url, pending } = await beginAuthorization(configFor());
    const params = await consent(url);
    const { code } = acceptCallback(pending, {
      code: params.get('code') ?? undefined,
      state: params.get('state') ?? undefined,
    });
    const tokens = await exchangeCode(pending, code, fetch);

    // 利用者が Google 側で接続を切った
    provider.refreshTokens.delete(tokens.refreshToken!);

    // **黙って続けない。**更新できないことを、そのまま失敗として出す。
    await expect(refresh(configFor(), tokens.refreshToken!, fetch)).rejects.toThrow();
  }, 60_000);

  it('forgets the token when the connection is dropped', async () => {
    const secrets = memoryStore();
    const store = new TokenStore(secrets);
    const { url, pending } = await beginAuthorization(configFor());
    const params = await consent(url);
    const { code } = acceptCallback(pending, {
      code: params.get('code') ?? undefined,
      state: params.get('state') ?? undefined,
    });
    const ref = await store.save(
      'com.astra.gmail',
      'gmail',
      await exchangeCode(pending, code, fetch),
    );

    await store.forget(ref);
    // 切ったのに残しておく理由が無い
    expect(await store.load(ref)).toBeNull();
    expect(secrets.values.size).toBe(0);
  }, 60_000);
});
