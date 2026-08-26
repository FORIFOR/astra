/**
 * 共有リンクの公開面クライアント。Phase 2 実装仕様 §2。
 *
 * **認証を持たない。**共有を受け取った相手が使うので、
 * アクセストークンの仕組みを一切持ち込まない。
 */
import {
  SharedArtifactView,
  UnlockShareResponse,
  tokenFromShareLink,
  type UnlockShareRequest,
} from '@astra/contracts';
import { z } from 'zod';

export interface PublicShareConfig {
  readonly baseUrl: string;
  readonly fetch?: typeof globalThis.fetch;
}

export interface UnlockedShare {
  readonly viewToken: string;
  readonly expiresInSeconds: number;
  readonly artifact: SharedArtifactView;
}

/**
 * 共有が開けなかった。
 *
 * **理由は無い。**サーバが区別して返さないので、クライアントも区別しない。
 * 「パスワードが違う」と表示するには、パスワードを送ったという事実だけを使う。
 */
export class ShareUnavailableError extends Error {
  readonly rateLimited: boolean;

  constructor(rateLimited: boolean) {
    super('this link is not available');
    this.name = 'ShareUnavailableError';
    this.rateLimited = rateLimited;
  }
}

export class PublicShareClient {
  readonly #config: PublicShareConfig;

  constructor(config: PublicShareConfig) {
    this.#config = config;
  }

  get #fetch(): typeof globalThis.fetch {
    return this.#config.fetch ?? globalThis.fetch;
  }

  get #base(): string {
    return this.#config.baseUrl.replace(/\/$/, '');
  }

  /** URL のフラグメントからトークンを取り出す。無ければ null。 */
  static tokenFromLocation(hash: string): string | null {
    return tokenFromShareLink(hash);
  }

  async unlock(token: string, options: UnlockShareRequest = {}): Promise<UnlockedShare> {
    const response = await this.#fetch(`${this.#base}/public/share/unlock`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token, ...options }),
    });

    if (!response.ok) throw new ShareUnavailableError(response.status === 429);

    const parsed = UnlockShareResponse.parse(await response.json());
    return {
      viewToken: parsed.view_token,
      expiresInSeconds: parsed.expires_in,
      artifact: parsed.artifact,
    };
  }

  /** 本文を取る。閲覧トークンは短命なので、期限切れは開き直しになる。 */
  async content(viewToken: string): Promise<Blob> {
    const response = await this.#fetch(`${this.#base}/public/share/content`, {
      headers: { authorization: `Share ${viewToken}` },
    });
    if (!response.ok) throw new ShareUnavailableError(false);
    return response.blob();
  }
}

/** viewer がそのまま描ける形かどうか。 */
export const RENDERABLE_MIME = z.enum(['text/plain', 'text/markdown', 'application/json']);

export function isRenderable(mimeType: string): boolean {
  return RENDERABLE_MIME.safeParse(mimeType.split(';')[0]?.trim()).success;
}
