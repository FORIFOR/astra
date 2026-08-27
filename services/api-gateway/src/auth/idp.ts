/**
 * 外部の身元提供者（Google / Apple / LINE）の ID トークン検証。実装仕様 §4.3。
 *
 * deepnote-desktop は Firebase を仲介にしていた。Astra は自分の identity を持つので、
 * **提供者の鍵で直接検証し、Astra のトークンを発行する。**
 * 端末から受け取るのは ID トークンだけ。access / refresh token は受け取らない。
 *
 * 設定されていない提供者は「使えない」と答える（`configured: false`）。
 * 空の client id で「使える」と言って、提供者の画面で意味不明に失敗させない。
 */
import { createHash } from 'node:crypto';
import { createRemoteJWKSet, jwtVerify, type JWTPayload, type JWTVerifyGetKey } from 'jose';
import {
  AstraError,
  type AuthProvidersResponse,
  type IdentityProvider,
  type IdpSignInRequest,
} from '@astra/contracts';

export const GOOGLE_JWKS_URL = 'https://www.googleapis.com/oauth2/v3/certs';
export const APPLE_JWKS_URL = 'https://appleid.apple.com/auth/keys';
export const LINE_VERIFY_URL = 'https://api.line.me/oauth2/v2.1/verify';
export const LINE_AUTHORIZE_URL = 'https://access.line.me/oauth2/v2.1/authorize';
export const LINE_TOKEN_URL = 'https://api.line.me/oauth2/v2.1/token';
export const APPLE_AUTHORIZE_URL = 'https://appleid.apple.com/auth/authorize';

export interface IdpConfig {
  /** 受け付ける Google の client id。端末の native client と、あれば web client。 */
  readonly google: { readonly clientIds: readonly string[] } | null;
  /**
   * Apple。native（ASAuthorization）の aud は bundle id、web relay の aud は Services ID。
   * web relay は公開 https の折り返し先が要る。
   */
  readonly apple: { readonly bundleId: string; readonly serviceId: string | null } | null;
  /** LINE。code の交換に channel secret が要るので、relay はサーバで行う。 */
  readonly line: { readonly channelId: string; readonly channelSecret: string } | null;
  /** relay の折り返し先を組む公開 URL（https）。無ければ relay は生えない。 */
  readonly publicUrl: string | null;
}

function list(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

export function idpConfigFromEnv(env: NodeJS.ProcessEnv = process.env): IdpConfig {
  const googleIds = list(env['ASTRA_AUTH_GOOGLE_CLIENT_IDS']);
  const appleBundle = env['ASTRA_AUTH_APPLE_BUNDLE_ID'] ?? '';
  const lineId = env['ASTRA_AUTH_LINE_CHANNEL_ID'] ?? '';
  const lineSecret = env['ASTRA_AUTH_LINE_CHANNEL_SECRET'] ?? '';
  const publicUrl = env['ASTRA_PUBLIC_URL']?.replace(/\/$/, '') ?? '';
  return {
    google: googleIds.length > 0 ? { clientIds: googleIds } : null,
    apple: appleBundle
      ? { bundleId: appleBundle, serviceId: env['ASTRA_AUTH_APPLE_SERVICE_ID'] || null }
      : null,
    line: lineId && lineSecret ? { channelId: lineId, channelSecret: lineSecret } : null,
    publicUrl:
      publicUrl.startsWith('https://') || publicUrl.startsWith('http://localhost')
        ? publicUrl
        : null,
  };
}

export interface VerifiedIdentity {
  readonly provider: IdentityProvider;
  readonly subject: string;
  readonly email: string | null;
  /** 提供者が「確認済み」と言ったメールだけ、既存の user への紐付けに使う。 */
  readonly emailVerified: boolean;
  readonly displayName: string | null;
}

export interface IdentityVerifier {
  verify(request: IdpSignInRequest): Promise<VerifiedIdentity>;
  providers(): AuthProvidersResponse['providers'];
  readonly config: IdpConfig;
}

export interface IdpDeps {
  /** JWKS の取り方。テストではローカルの鍵束を渡す。 */
  readonly jwks?: (url: string) => JWTVerifyGetKey;
  readonly fetchImpl?: typeof fetch;
}

function rejected(reason: string): AstraError {
  return new AstraError('auth.idp_rejected', reason);
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/** Apple / Google の nonce は「生の nonce の SHA-256 hex」が claim に入る。 */
export function hashedNonce(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

export class IdpVerifiers implements IdentityVerifier {
  readonly config: IdpConfig;
  readonly #jwks: (url: string) => JWTVerifyGetKey;
  readonly #fetch: typeof fetch;
  readonly #keySets = new Map<string, JWTVerifyGetKey>();

  constructor(config: IdpConfig, deps: IdpDeps = {}) {
    this.config = config;
    this.#jwks = deps.jwks ?? ((url) => createRemoteJWKSet(new URL(url)));
    this.#fetch = deps.fetchImpl ?? fetch;
  }

  providers(): AuthProvidersResponse['providers'] {
    const relay = (path: string): string | null => (this.config.publicUrl ? path : null);
    return [
      {
        id: 'google',
        configured: this.config.google !== null,
        client_id: this.config.google?.clientIds[0] ?? null,
        relay_path: null,
      },
      {
        id: 'apple',
        // web relay が組めるときだけ「使える」。native だけでは未署名の開発ビルドで動かない
        configured:
          this.config.apple !== null &&
          this.config.apple.serviceId !== null &&
          this.config.publicUrl !== null,
        client_id: this.config.apple?.serviceId ?? null,
        relay_path: this.config.apple?.serviceId ? relay('/v1/auth/apple/desktop') : null,
      },
      {
        id: 'line',
        configured: this.config.line !== null && this.config.publicUrl !== null,
        client_id: this.config.line?.channelId ?? null,
        relay_path: this.config.line ? relay('/v1/auth/line/desktop') : null,
      },
    ];
  }

  #keys(url: string): JWTVerifyGetKey {
    let set = this.#keySets.get(url);
    if (!set) {
      set = this.#jwks(url);
      this.#keySets.set(url, set);
    }
    return set;
  }

  async verify(request: IdpSignInRequest): Promise<VerifiedIdentity> {
    switch (request.provider) {
      case 'google':
        return this.#google(request);
      case 'apple':
        return this.#apple(request);
      case 'line':
        return this.#line(request);
    }
  }

  async #google(request: IdpSignInRequest): Promise<VerifiedIdentity> {
    const google = this.config.google;
    if (!google) throw new AstraError('auth.provider_not_configured', 'google is not configured');
    const payload = await this.#verifyJwt(request.id_token, GOOGLE_JWKS_URL, {
      issuer: ['https://accounts.google.com', 'accounts.google.com'],
      audience: [...google.clientIds],
    });
    const subject = str(payload.sub);
    if (!subject) throw rejected('google token has no subject');
    return {
      provider: 'google',
      subject,
      email: str(payload['email']),
      emailVerified: payload['email_verified'] === true,
      displayName: str(payload['name']) ?? request.display_name,
    };
  }

  async #apple(request: IdpSignInRequest): Promise<VerifiedIdentity> {
    const apple = this.config.apple;
    if (!apple) throw new AstraError('auth.provider_not_configured', 'apple is not configured');
    const audience = [apple.bundleId, ...(apple.serviceId ? [apple.serviceId] : [])];
    const payload = await this.#verifyJwt(request.id_token, APPLE_JWKS_URL, {
      issuer: 'https://appleid.apple.com',
      audience,
    });
    // native flow: 端末が作った nonce の hash が claim に入っていなければ、別の依頼のトークン
    if (request.nonce !== null && payload['nonce'] !== hashedNonce(request.nonce)) {
      throw rejected('apple token nonce does not match');
    }
    const subject = str(payload.sub);
    if (!subject) throw rejected('apple token has no subject');
    const verified = payload['email_verified'];
    return {
      provider: 'apple',
      subject,
      email: str(payload['email']),
      emailVerified: verified === true || verified === 'true',
      // Apple は名前をトークンに入れない。初回に端末が受け取ったものを使う
      displayName: request.display_name,
    };
  }

  async #line(request: IdpSignInRequest): Promise<VerifiedIdentity> {
    const line = this.config.line;
    if (!line) throw new AstraError('auth.provider_not_configured', 'line is not configured');
    // LINE は JWKS ではなく verify endpoint。署名・aud・期限は LINE 側が見る
    const body = new URLSearchParams({ id_token: request.id_token, client_id: line.channelId });
    if (request.nonce) body.set('nonce', request.nonce);
    const response = await this.#fetch(LINE_VERIFY_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });
    const json = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    if (!response.ok) {
      throw rejected(
        str(json['error_description']) ?? str(json['error']) ?? 'line rejected the token',
      );
    }
    const subject = str(json['sub']);
    if (!subject) throw rejected('line token has no subject');
    return {
      provider: 'line',
      subject,
      email: str(json['email']),
      // LINE の verify が返すメールは、LINE 側で確認済みのもの
      emailVerified: str(json['email']) !== null,
      displayName: str(json['name']) ?? request.display_name,
    };
  }

  async #verifyJwt(
    token: string,
    jwksUrl: string,
    options: { issuer: string | string[]; audience: string[] },
  ): Promise<JWTPayload> {
    try {
      const { payload } = await jwtVerify(token, this.#keys(jwksUrl), {
        issuer: options.issuer,
        audience: options.audience,
      });
      return payload;
    } catch (cause) {
      // 署名 / aud / iss / exp のどれで落ちたかは開発者向けの message に残し、利用者には code だけ
      throw rejected(cause instanceof Error ? cause.message : 'token verification failed');
    }
  }
}
