/**
 * トークンの発行と検証。実装仕様 §4.2。
 *
 * 検証は `TokenVerifier` の背後に置く。Phase 1 で実 IdP へ差し替えるとき、
 * 触るのがこの実装だけになるようにするため（§4.3・§18 OQ-1）。
 */
import { SignJWT, jwtVerify } from 'jose';
import {
  ACCESS_TOKEN_TTL_SECONDS,
  AccessTokenClaims,
  AstraError,
  DEVICE_TOKEN_TTL_SECONDS,
  uuidv7,
} from '@astra/contracts';
import type { SigningKeys } from './keys.js';

export const AUDIENCE_API = 'astra-api';
/** host bridge 専用。アクセストークンでホスト実行を呼べないようにする（§10.1）。 */
export const AUDIENCE_HOST_BRIDGE = 'astra-host-bridge';

export interface TokenIssuerConfig {
  readonly issuer: string;
  readonly keys: SigningKeys;
}

export interface Principal {
  readonly userId: string;
  readonly tenantId: string;
  readonly deviceId: string;
  readonly scopes: readonly string[];
}

export interface TokenVerifier {
  verifyAccessToken(token: string): Promise<AccessTokenClaims>;
  verifyDeviceToken(token: string): Promise<AccessTokenClaims>;
}

export class JwtTokens implements TokenVerifier {
  readonly #config: TokenIssuerConfig;

  constructor(config: TokenIssuerConfig) {
    this.#config = config;
  }

  async issueAccessToken(principal: Principal, now: Date = new Date()): Promise<string> {
    return this.#sign(principal, AUDIENCE_API, ACCESS_TOKEN_TTL_SECONDS, now);
  }

  async issueDeviceToken(principal: Principal, now: Date = new Date()): Promise<string> {
    return this.#sign(principal, AUDIENCE_HOST_BRIDGE, DEVICE_TOKEN_TTL_SECONDS, now);
  }

  async #sign(
    principal: Principal,
    audience: string,
    ttlSeconds: number,
    now: Date,
  ): Promise<string> {
    const issuedAt = Math.floor(now.getTime() / 1000);
    return new SignJWT({
      tid: principal.tenantId,
      did: principal.deviceId,
      scp: [...principal.scopes],
    })
      .setProtectedHeader({ alg: 'EdDSA', kid: this.#config.keys.keyId })
      .setIssuer(this.#config.issuer)
      .setAudience(audience)
      .setSubject(principal.userId)
      .setJti(uuidv7())
      .setIssuedAt(issuedAt)
      .setExpirationTime(issuedAt + ttlSeconds)
      .sign(this.#config.keys.privateKey);
  }

  verifyAccessToken(token: string): Promise<AccessTokenClaims> {
    return this.#verify(token, AUDIENCE_API);
  }

  verifyDeviceToken(token: string): Promise<AccessTokenClaims> {
    return this.#verify(token, AUDIENCE_HOST_BRIDGE);
  }

  async #verify(token: string, audience: string): Promise<AccessTokenClaims> {
    let payload: unknown;
    try {
      const result = await jwtVerify(token, this.#config.keys.publicKey, {
        issuer: this.#config.issuer,
        audience,
        algorithms: ['EdDSA'],
        clockTolerance: 5,
      });
      payload = result.payload;
    } catch (error) {
      const code = (error as { code?: string }).code;
      // 期限切れだけは区別する。クライアントが refresh すべきか判断できるようにするため。
      if (code === 'ERR_JWT_EXPIRED') {
        throw new AstraError('auth.expired_token', 'access token expired');
      }
      throw new AstraError('auth.invalid_token', 'token verification failed');
    }

    const parsed = AccessTokenClaims.safeParse(payload);
    if (!parsed.success) {
      // 署名は通ったが中身が契約と違う。鍵漏洩か版ずれなので通さない。
      throw new AstraError('auth.invalid_token', 'token claims do not match the contract');
    }
    return parsed.data;
  }
}

/** `Authorization: Bearer <token>` から取り出す。 */
export function bearerToken(header: string | undefined): string | null {
  if (!header) return null;
  const match = /^Bearer (.+)$/.exec(header);
  return match?.[1] ?? null;
}
