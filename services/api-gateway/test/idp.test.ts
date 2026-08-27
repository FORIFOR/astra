import { describe, expect, it } from 'vitest';
import { SignJWT, createLocalJWKSet, exportJWK, generateKeyPair } from 'jose';
import { AstraError } from '@astra/contracts';
import {
  APPLE_JWKS_URL,
  GOOGLE_JWKS_URL,
  IdpVerifiers,
  hashedNonce,
  idpConfigFromEnv,
} from '../src/auth/idp.js';

async function keyed() {
  const { publicKey, privateKey } = await generateKeyPair('RS256');
  const jwk = { ...(await exportJWK(publicKey)), kid: 'k1', alg: 'RS256', use: 'sig' };
  const jwks = createLocalJWKSet({ keys: [jwk] });
  const sign = (claims: Record<string, unknown>, iss: string, aud: string) =>
    new SignJWT(claims)
      .setProtectedHeader({ alg: 'RS256', kid: 'k1' })
      .setIssuer(iss)
      .setAudience(aud)
      .setIssuedAt()
      .setExpirationTime('5m')
      .sign(privateKey);
  return { jwks, sign };
}

const base = {
  nonce: null,
  display_name: null,
  device_name: 'test',
  platform: 'macos',
  app_version: '0.1.0',
} as const;

describe('idp verifiers', () => {
  it('accepts a Google ID token for a configured client and reads the verified email', async () => {
    const { jwks, sign } = await keyed();
    const verifier = new IdpVerifiers(
      {
        google: { clientIds: ['native.apps.googleusercontent.com'] },
        apple: null,
        line: null,
        publicUrl: null,
      },
      {
        jwks: (url) => {
          expect(url).toBe(GOOGLE_JWKS_URL);
          return jwks;
        },
      },
    );
    const token = await sign(
      { sub: 'g-123', email: 'a@example.com', email_verified: true, name: 'Aki' },
      'https://accounts.google.com',
      'native.apps.googleusercontent.com',
    );
    await expect(
      verifier.verify({ ...base, provider: 'google', id_token: token }),
    ).resolves.toEqual({
      provider: 'google',
      subject: 'g-123',
      email: 'a@example.com',
      emailVerified: true,
      displayName: 'Aki',
    });
  });

  it('rejects a Google token minted for another client id', async () => {
    const { jwks, sign } = await keyed();
    const verifier = new IdpVerifiers(
      { google: { clientIds: ['ours'] }, apple: null, line: null, publicUrl: null },
      { jwks: () => jwks },
    );
    const token = await sign({ sub: 'g-1' }, 'https://accounts.google.com', 'theirs');
    await expect(
      verifier.verify({ ...base, provider: 'google', id_token: token }),
    ).rejects.toMatchObject({
      code: 'auth.idp_rejected',
    });
  });

  it('checks the Apple nonce against the hashed claim', async () => {
    const { jwks, sign } = await keyed();
    const verifier = new IdpVerifiers(
      {
        google: null,
        apple: { bundleId: 'com.astra.desktop', serviceId: null },
        line: null,
        publicUrl: null,
      },
      {
        jwks: (url) => {
          expect(url).toBe(APPLE_JWKS_URL);
          return jwks;
        },
      },
    );
    const token = await sign(
      {
        sub: 'apple-1',
        email: 'p@privaterelay.appleid.com',
        email_verified: 'true',
        nonce: hashedNonce('raw-nonce'),
      },
      'https://appleid.apple.com',
      'com.astra.desktop',
    );
    await expect(
      verifier.verify({
        ...base,
        provider: 'apple',
        id_token: token,
        nonce: 'raw-nonce',
        display_name: '山田 太郎',
      }),
    ).resolves.toMatchObject({ subject: 'apple-1', emailVerified: true, displayName: '山田 太郎' });
    await expect(
      verifier.verify({ ...base, provider: 'apple', id_token: token, nonce: 'other' }),
    ).rejects.toMatchObject({ code: 'auth.idp_rejected' });
  });

  it('verifies LINE through the verify endpoint and never through a local key', async () => {
    const calls: string[] = [];
    const verifier = new IdpVerifiers(
      {
        google: null,
        apple: null,
        line: { channelId: '1234', channelSecret: 's' },
        publicUrl: 'https://astra.example',
      },
      {
        fetchImpl: (async (url: string, init: RequestInit) => {
          calls.push(`${url} ${init.body}`);
          return new Response(JSON.stringify({ sub: 'U1', name: 'Line User' }), { status: 200 });
        }) as unknown as typeof fetch,
      },
    );
    await expect(
      verifier.verify({ ...base, provider: 'line', id_token: 'x'.repeat(30) }),
    ).resolves.toMatchObject({
      provider: 'line',
      subject: 'U1',
      email: null,
      emailVerified: false,
      displayName: 'Line User',
    });
    expect(calls[0]).toContain('client_id=1234');
  });

  it('answers not_configured instead of guessing when a provider has no client id', async () => {
    const verifier = new IdpVerifiers({ google: null, apple: null, line: null, publicUrl: null });
    await expect(
      verifier.verify({ ...base, provider: 'google', id_token: 'x'.repeat(30) }),
    ).rejects.toSatisfy(
      (e: unknown) => e instanceof AstraError && e.code === 'auth.provider_not_configured',
    );
    expect(verifier.providers().map((p) => p.configured)).toEqual([false, false, false]);
  });

  it('only calls apple/line configured when the relay has a public https origin', () => {
    const env = {
      ASTRA_AUTH_GOOGLE_CLIENT_IDS: 'a, b',
      ASTRA_AUTH_APPLE_BUNDLE_ID: 'com.astra.desktop',
      ASTRA_AUTH_APPLE_SERVICE_ID: 'com.astra.web',
      ASTRA_AUTH_LINE_CHANNEL_ID: '1',
      ASTRA_AUTH_LINE_CHANNEL_SECRET: 's',
    };
    const withoutUrl = new IdpVerifiers(idpConfigFromEnv({ ...env })).providers();
    expect(withoutUrl.map((p) => [p.id, p.configured])).toEqual([
      ['google', true],
      ['apple', false],
      ['line', false],
    ]);
    const withUrl = new IdpVerifiers(
      idpConfigFromEnv({ ...env, ASTRA_PUBLIC_URL: 'https://astra.example/' }),
    ).providers();
    expect(withUrl.map((p) => [p.id, p.configured, p.relay_path])).toEqual([
      ['google', true, null],
      ['apple', true, '/v1/auth/apple/desktop'],
      ['line', true, '/v1/auth/line/desktop'],
    ]);
    expect(withUrl[0]?.client_id).toBe('a');
  });
});
