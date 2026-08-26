/**
 * HTTP の土台。実装仕様 §11。
 *
 * トークンの取得を関数で受けるのは、更新の責務をここに持ち込まないため。
 * ローテーション（§4.2）はアプリ側の関心で、クライアントは常に「今の値」を尋ねる。
 */
import { AstraError, HEADER_IDEMPOTENCY_KEY, HEADER_REQUEST_ID, uuidv7 } from '@astra/contracts';
import { errorFrom } from './errors.js';

export interface ClientConfig {
  readonly baseUrl: string;
  /** 呼ばれるたびに現在のアクセストークンを返す。null なら未認証で送る。 */
  accessToken(): string | null | Promise<string | null>;
  /** テストや Tauri 環境で差し替えるため */
  readonly fetch?: typeof globalThis.fetch;
  /** 401 を受けたときに一度だけ呼ばれる。true を返せば同じ要求を 1 回だけやり直す。 */
  onUnauthorized?(): Promise<boolean>;
}

export interface RequestOptions {
  readonly method?: string;
  readonly path: string;
  readonly query?: Record<string, string | number | undefined>;
  readonly body?: unknown;
  readonly idempotencyKey?: string;
  readonly signal?: AbortSignal;
}

export class HttpClient {
  readonly #config: ClientConfig;

  constructor(config: ClientConfig) {
    this.#config = config;
  }

  get baseUrl(): string {
    return this.#config.baseUrl.replace(/\/$/, '');
  }

  /** 設定された fetch。SSE も同じものを使う（テストで差し替えられるように）。 */
  get fetcher(): typeof globalThis.fetch {
    return this.#config.fetch ?? globalThis.fetch;
  }

  urlFor(path: string, query?: RequestOptions['query']): string {
    const url = new URL(this.baseUrl + path);
    for (const [key, value] of Object.entries(query ?? {})) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }
    return url.toString();
  }

  async headers(extra?: Record<string, string>): Promise<Headers> {
    const headers = new Headers(extra);
    headers.set(HEADER_REQUEST_ID, uuidv7());
    const token = await this.#config.accessToken();
    if (token) headers.set('authorization', `Bearer ${token}`);
    return headers;
  }

  async request<T>(options: RequestOptions, parse: (value: unknown) => T): Promise<T> {
    const response = await this.#send(options);
    if (response.status === 204) return parse(undefined);
    return parse(await response.json());
  }

  async send(options: RequestOptions): Promise<Response> {
    return this.#send(options);
  }

  async #send(options: RequestOptions, retried = false): Promise<Response> {
    const doFetch = this.fetcher;
    const headers = await this.headers(
      options.body === undefined ? undefined : { 'content-type': 'application/json' },
    );
    if (options.idempotencyKey) headers.set(HEADER_IDEMPOTENCY_KEY, options.idempotencyKey);

    const response = await doFetch(this.urlFor(options.path, options.query), {
      method: options.method ?? 'GET',
      headers,
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
      ...(options.signal ? { signal: options.signal } : {}),
    });

    if (response.ok) return response;

    // 401 は一度だけ回復を試す。無限に繰り返すと、失効した資格情報で叩き続ける。
    if (response.status === 401 && !retried && this.#config.onUnauthorized) {
      if (await this.#config.onUnauthorized()) return this.#send(options, true);
    }

    throw await errorFrom(response);
  }
}

export function requireOk<T>(value: T | undefined, what: string): T {
  if (value === undefined) throw new AstraError('common.internal', `expected ${what}`);
  return value;
}
