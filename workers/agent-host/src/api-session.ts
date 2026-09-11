import type { SecretStore } from '@astra/oauth';

/** A host owns its refresh chain. Never share this key with the desktop session. */
export class ApiSession {
  private access: string;
  private expiresAt: number;
  private refreshing: Promise<string> | undefined;
  private refreshToken: string | null = null;
  private failure: Error | undefined;
  private retryAt = 0;
  private readonly key: string;

  constructor(
    private readonly options: {
      baseUrl: string;
      token?: string;
      refreshToken?: string;
      secrets: SecretStore;
      fetch?: typeof fetch;
      now?: () => number;
    },
  ) {
    const url = new URL(options.baseUrl);
    if (
      url.protocol !== 'https:' &&
      !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))
    )
      throw new Error('API credentials require HTTPS or loopback');
    this.key = `astra.host-session.${url.origin}`;
    this.access = options.token ?? '';
    this.expiresAt = expiry(this.access);
  }

  async start(): Promise<void> {
    const stored = await this.options.secrets.get(this.key);
    if (this.options.refreshToken) {
      this.refreshToken = this.options.refreshToken;
      await this.persist(this.refreshToken, false);
    } else if (stored?.startsWith('{')) {
      const record = JSON.parse(stored) as { refreshToken?: string; pending?: boolean };
      if (record.pending) throw new Error('Previous API renewal was interrupted; sign in again');
      this.refreshToken = record.refreshToken ?? null;
    } else {
      this.refreshToken = stored;
    }
    if (!this.access && !this.refreshToken)
      throw new Error('Sign in before starting the agent host');
    await this.token();
  }

  private async persist(refreshToken: string, pending: boolean): Promise<void> {
    await this.options.secrets.set(this.key, JSON.stringify({ refreshToken, pending }));
  }

  private now(): number {
    return (this.options.now ?? Date.now)();
  }

  async token(rejected?: string): Promise<string> {
    if (this.failure) throw this.failure;
    if (this.refreshing) return this.refreshing;
    if (
      this.access &&
      this.expiresAt > this.now() + 60_000 &&
      (!rejected || rejected !== this.access)
    )
      return this.access;
    // Legacy, explicitly supplied tokens still work until expiry. They cannot be renewed.
    if (!this.refreshToken) {
      if (this.access && !rejected && this.expiresAt > this.now()) return this.access;
      this.failure = new Error('API session expired; sign in again to reconnect this host');
      throw this.failure;
    }
    if (this.now() < this.retryAt) throw new Error('API session renewal is waiting before retry');
    this.refreshing = this.rotate();
    try {
      return await this.refreshing;
    } finally {
      this.refreshing = undefined;
    }
  }

  private async rotate(): Promise<string> {
    try {
      // Write-ahead marker survives a crash or lost response. A restarted process must
      // never replay a refresh token which the server may already have consumed.
      await this.persist(this.refreshToken!, true);
      const response = await (this.options.fetch ?? fetch)(
        `${this.options.baseUrl}/v1/auth/refresh`,
        {
          method: 'POST',
          redirect: 'error',
          signal: AbortSignal.timeout(15_000),
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ refresh_token: this.refreshToken }),
        },
      );
      // A rate limit rejects the call before rotation. Network/5xx outcomes are ambiguous:
      // never replay a possibly consumed refresh token and revoke the whole family.
      if (response.status === 429) {
        await this.persist(this.refreshToken!, false);
        this.retryAt = this.now() + 60_000;
        throw new Error('API session renewal rate limited');
      }
      if (!response.ok)
        throw new Error(`API session renewal failed (${response.status}); sign in again`);
      const body = (await response.json()) as Record<string, unknown>;
      if (
        typeof body['access_token'] !== 'string' ||
        !body['access_token'] ||
        typeof body['refresh_token'] !== 'string' ||
        !body['refresh_token'] ||
        typeof body['expires_in'] !== 'number' ||
        body['expires_in'] <= 0
      )
        throw new Error('Invalid API session response; sign in again');
      await this.persist(body['refresh_token'], false);
      this.refreshToken = body['refresh_token'];
      this.access = body['access_token'];
      this.expiresAt = this.now() + body['expires_in'] * 1000;
      return this.access;
    } catch (error) {
      if (!this.retryAt || this.retryAt <= this.now())
        this.failure = new Error('API session could not be renewed safely; sign in again');
      throw this.failure ?? error;
    }
  }

  /** Only authentication rejection is retried, once. Never retry a timeout or a 5xx mutation. */
  readonly fetch: typeof fetch = async (input, init) => {
    const request = new Request(input, init);
    const base = new URL(this.options.baseUrl);
    if (new URL(request.url).origin !== base.origin)
      throw new Error('Refusing to send API credentials to another origin');
    const send = async (token: string) => {
      const headers = new Headers(request.headers);
      headers.set('authorization', `Bearer ${token}`);
      return (this.options.fetch ?? fetch)(
        new Request(request.clone(), { headers, redirect: 'error' }),
      );
    };
    const token = await this.token();
    const response = await send(token);
    if (response.status !== 401) return response;
    const rejected = (await response
      .clone()
      .json()
      .catch(() => null)) as { error?: { code?: string } } | null;
    // Only our gateway's pre-handler authentication errors guarantee the action did not run.
    if (
      !['auth.expired_token', 'auth.invalid_token', 'auth.missing_token'].includes(
        rejected?.error?.code ?? '',
      )
    )
      return response;
    await response.body?.cancel();
    return send(await this.token(token));
  };
}

function expiry(token: string): number {
  try {
    const data = JSON.parse(Buffer.from(token.split('.')[1] ?? '', 'base64url').toString()) as {
      exp?: number;
    };
    return typeof data.exp === 'number' ? data.exp * 1000 : Infinity;
  } catch {
    return Infinity;
  }
}
