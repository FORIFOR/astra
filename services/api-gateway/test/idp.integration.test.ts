/**
 * 提供者サインインの結合テスト。実装仕様 §4.3。
 *   ./infra/db/with-test-db.sh pnpm --filter @astra/service-api-gateway test
 *
 * 提供者の鍵は持たないので、検証は差し替える。ここで見るのは **結び方**:
 * 同じ主体は同じ user、確認済みメールは既存 user へ、未確認メールは結ばない。
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { type ApiError, type MeResponse, type TokenResponse, uuidv7 } from '@astra/contracts';
import { createDb, type DbHandle } from '@astra/db';
import { makeTestApp, makeTokens, testDbConfig, type TestApp } from './support.js';
import type { JwtTokens } from '../src/auth/tokens.js';
import type { App } from '../src/fastify.js';
import type { IdentityVerifier, VerifiedIdentity } from '../src/auth/idp.js';

const url = process.env['TEST_DATABASE_URL'];
const identityUrl = process.env['TEST_IDENTITY_DATABASE_URL'];

class StubVerifier implements IdentityVerifier {
  readonly config = {
    google: { clientIds: ['x'] },
    apple: null,
    line: null,
    publicUrl: null,
  } as const;
  readonly identities = new Map<string, VerifiedIdentity>();
  async verify(request: { id_token: string }): Promise<VerifiedIdentity> {
    const found = this.identities.get(request.id_token);
    if (!found) {
      const { AstraError } = await import('@astra/contracts');
      throw new AstraError('auth.idp_rejected', 'unknown stub token');
    }
    return found;
  }
  providers() {
    return [
      { id: 'google' as const, configured: true, client_id: 'x', relay_path: null },
      { id: 'apple' as const, configured: false, client_id: null, relay_path: null },
      { id: 'line' as const, configured: false, client_id: null, relay_path: null },
    ];
  }
}

describe.skipIf(!url)('sign-in with an identity provider', () => {
  let db: DbHandle;
  let app: App;
  let harness: TestApp;
  let tokens: JwtTokens;
  let verifier: StubVerifier;

  const signIn = async (idToken: string, expectStatus = 200) => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/auth/idp/token',
      payload: { provider: 'google', id_token: idToken },
    });
    expect(res.statusCode).toBe(expectStatus);
    return res;
  };
  const whoami = async (access: string): Promise<MeResponse> => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/me',
      headers: { authorization: `Bearer ${access}` },
    });
    expect(res.statusCode).toBe(200);
    return res.json<MeResponse>();
  };

  beforeAll(async () => {
    db = createDb(testDbConfig(url!, identityUrl));
    tokens = await makeTokens();
  });
  beforeEach(async () => {
    verifier = new StubVerifier();
    harness = await makeTestApp({
      db,
      dbConfig: testDbConfig(url!, identityUrl),
      tokens,
      identityVerifier: verifier,
    });
    app = harness.app;
  });
  afterEach(async () => {
    await app.close();
  });

  it('lists providers with their configured flag and the dev sign-in switch', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/auth/providers' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ providers: verifier.providers(), dev_email: true });
  });

  it('creates a personal tenant on first sign-in and reuses it for the same subject', async () => {
    const email = `g-${uuidv7()}@example.com`;
    verifier.identities.set('t1'.padEnd(24, '.'), {
      provider: 'google',
      subject: `sub-${email}`,
      email,
      emailVerified: true,
      displayName: 'Aki',
    });
    const first = (await signIn('t1'.padEnd(24, '.'))).json<TokenResponse>();
    const me1 = await whoami(first.access_token);
    expect(me1.user.email).toBe(email);
    expect(me1.user.display_name).toBe('Aki');
    expect(me1.role).toBe('owner');

    const second = (await signIn('t1'.padEnd(24, '.'))).json<TokenResponse>();
    const me2 = await whoami(second.access_token);
    expect(me2.user.id).toBe(me1.user.id);
    expect(me2.tenant.id).toBe(me1.tenant.id);
    // 端末は毎回登録される（別の Mac から入ることもある）
    expect(me2.device.id).not.toBe(me1.device.id);
  });

  it('links a verified email to the user who signed up by email, but never an unverified one', async () => {
    const email = `link-${uuidv7()}@example.com`;
    const dev = await app.inject({
      method: 'POST',
      url: '/v1/auth/dev/token',
      payload: { email, display_name: 'Dev' },
    });
    const devMe = await whoami(dev.json<TokenResponse>().access_token);

    verifier.identities.set('verified'.padEnd(24, '.'), {
      provider: 'google',
      subject: 'sub-verified',
      email,
      emailVerified: true,
      displayName: null,
    });
    const linked = await whoami(
      (await signIn('verified'.padEnd(24, '.'))).json<TokenResponse>().access_token,
    );
    expect(linked.user.id).toBe(devMe.user.id);

    verifier.identities.set('unverified'.padEnd(24, '.'), {
      provider: 'google',
      subject: 'sub-unverified',
      email,
      emailVerified: false,
      displayName: null,
    });
    // 同じメールでも未確認なら、他人の可能性がある。既存の user には結ばず、別の user になる
    const other = await whoami(
      (await signIn('unverified'.padEnd(24, '.'))).json<TokenResponse>().access_token,
    );
    expect(other.user.id).not.toBe(devMe.user.id);
    expect(other.user.email).not.toBe(email);
  });

  it('rejects a token the verifier does not accept with auth.idp_rejected', async () => {
    const res = await signIn('nope'.padEnd(24, '.'), 401);
    expect(res.json<ApiError>().error.code).toBe('auth.idp_rejected');
  });
});
