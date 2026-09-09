import type { LanguageModelKind } from '@astra/contracts';

export interface HttpLlmConfig {
  readonly kind: LanguageModelKind;
  readonly endpoint: string;
  readonly model: string;
  readonly apiKey?: string;
  readonly timeoutMs?: number;
  readonly fetch?: typeof globalThis.fetch;
}

/** OpenAI互換のchat/completionsを使うAPI／ローカルサーバー用の薄い境界。 */
export class HttpLlmClient {
  readonly #config: HttpLlmConfig;
  readonly #fetch: typeof globalThis.fetch;

  constructor(config: HttpLlmConfig) {
    this.#config = config;
    this.#fetch = config.fetch ?? globalThis.fetch;
  }

  async probe(): Promise<{ available: boolean; version: string | null; reason: string | null }> {
    try {
      const response = await this.#fetch(`${this.#config.endpoint.replace(/\/$/, '')}/models`, {
        headers: this.#headers(),
        signal: AbortSignal.timeout(this.#config.timeoutMs ?? 10_000),
      });
      return response.ok
        ? { available: true, version: this.#config.model, reason: null }
        : { available: false, version: null, reason: `${this.#config.kind} endpoint returned ${response.status}` };
    } catch {
      return { available: false, version: null, reason: `${this.#config.kind} endpoint is unavailable` };
    }
  }

  async ask(prompt: string): Promise<unknown> {
    const response = await this.#fetch(`${this.#config.endpoint.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: { ...this.#headers(), 'content-type': 'application/json' },
      body: JSON.stringify({ model: this.#config.model, messages: [{ role: 'user', content: prompt }] }),
      signal: AbortSignal.timeout(this.#config.timeoutMs ?? 120_000),
    });
    if (!response.ok) throw new Error(`${this.#config.kind} request failed (${response.status})`);
    const body = (await response.json()) as { choices?: readonly { message?: { content?: unknown } }[] };
    return body.choices?.[0]?.message?.content ?? '';
  }

  #headers(): Record<string, string> {
    return this.#config.apiKey ? { authorization: `Bearer ${this.#config.apiKey}` } : {};
  }
}
