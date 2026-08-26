/**
 * Claude を `LanguageModel` として使う。Phase 2 実装仕様 §1.1（OQ-3）。
 *
 * 設計の要:
 *
 *   **モデルの出力を信用しない。**構造は tool 呼び出しで強制し、
 *   中身は呼び出し側で機械検査する。特に `extractClaims` の根拠は
 *   **抜粋の中に実在する文字列でなければ捨てる**。ここを緩めると、
 *   Evidence Ledger に「もっともらしいが原文に無い」根拠が積まれる。
 *
 *   HTTP は差し替え口にしてある。テストは実際の API を叩かない。
 */
import { z } from 'zod';
import type { ExtractedClaim, LanguageModel, SearchHit } from './providers.js';

/** `fetch` と同じ形。テストは偽物を渡す。 */
export type Fetch = (url: string, init: RequestInit) => Promise<Response>;

export interface AnthropicConfig {
  readonly apiKey: string;
  /** 既定は最新の Sonnet。分解・抽出・統合はここで十分足りる。 */
  readonly model?: string;
  readonly baseUrl?: string;
  readonly maxTokens?: number;
  readonly fetch?: Fetch;
  /** 1 回だけやり直す。壊れた JSON でパイプラインを落とさないため。 */
  readonly retries?: number;
}

const DEFAULT_MODEL = 'claude-sonnet-5';
const API_VERSION = '2023-06-01';

const ToolUse = z.object({
  type: z.literal('tool_use'),
  name: z.string(),
  input: z.unknown(),
});

const MessageResponse = z.object({
  content: z.array(z.union([ToolUse, z.object({ type: z.string() }).passthrough()])),
});

interface ToolSpec {
  readonly name: string;
  readonly description: string;
  readonly input_schema: Record<string, unknown>;
}

const stringList = (property: string, description: string): Record<string, unknown> => ({
  type: 'object',
  properties: {
    [property]: { type: 'array', items: { type: 'string' }, description },
  },
  required: [property],
});

const TOOLS = {
  decompose: {
    name: 'record_sub_queries',
    description: '質問を、独立に検索できる下位クエリへ分解して記録する。',
    input_schema: stringList('queries', 'それぞれ単独で検索できる短い問い'),
  },
  extract: {
    name: 'record_claims',
    description: '抜粋から、確認できる主張とその根拠箇所を記録する。',
    input_schema: {
      type: 'object',
      properties: {
        claims: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              claim: { type: 'string', description: '抜粋から確認できる主張' },
              support_text: {
                type: 'string',
                description: '根拠になった箇所を、抜粋から**そのまま**引き写したもの',
              },
            },
            required: ['claim', 'support_text'],
          },
        },
      },
      required: ['claims'],
    },
  },
  synthesize: {
    name: 'record_conclusions',
    description: '根拠から導ける結論だけを記録する。',
    input_schema: stringList('conclusions', '根拠から確認できる結論'),
  },
  contradictions: {
    name: 'record_contradictions',
    description: '互いに両立しない主張の組を記録する。',
    input_schema: {
      type: 'object',
      properties: {
        pairs: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              left: { type: 'integer', description: '0 始まりの番号' },
              right: { type: 'integer', description: '0 始まりの番号' },
            },
            required: ['left', 'right'],
          },
        },
      },
      required: ['pairs'],
    },
  },
} as const satisfies Record<string, ToolSpec>;

export class AnthropicLanguageModel implements LanguageModel {
  readonly name: string;
  readonly isStandIn = false;
  readonly #apiKey: string;
  readonly #model: string;
  readonly #baseUrl: string;
  readonly #maxTokens: number;
  readonly #fetch: Fetch;
  readonly #retries: number;

  constructor(config: AnthropicConfig) {
    if (!config.apiKey) throw new Error('an Anthropic API key is required');
    this.#apiKey = config.apiKey;
    this.#model = config.model ?? DEFAULT_MODEL;
    this.name = `anthropic:${this.#model}`;
    this.#baseUrl = config.baseUrl ?? 'https://api.anthropic.com';
    this.#maxTokens = config.maxTokens ?? 2_048;
    this.#fetch = config.fetch ?? ((url, init) => fetch(url, init));
    this.#retries = config.retries ?? 1;
  }

  async decompose(question: string, max: number): Promise<string[]> {
    const out = await this.#call(
      TOOLS.decompose,
      [
        `次の問いを、独立に検索できる下位クエリへ最大 ${max} 個に分解してください。`,
        '重複するもの、答えを先取りしたものは作らないでください。',
        '',
        `問い: ${question}`,
      ].join('\n'),
      z.object({ queries: z.array(z.string()) }),
    );
    // 空文字と重複は捨てる。検索が空振りするだけで害しかない。
    const seen = new Set<string>();
    const queries = out.queries
      .map((q) => q.trim())
      .filter((q) => q.length > 0 && !seen.has(q) && seen.add(q) !== undefined)
      .slice(0, max);
    // 何も返らなければ、元の問いをそのまま検索する。黙って諦めない。
    return queries.length > 0 ? queries : [question];
  }

  async extractClaims(question: string, hit: SearchHit): Promise<ExtractedClaim[]> {
    const out = await this.#call(
      TOOLS.extract,
      [
        'この抜粋から、確認できる主張だけを取り出してください。',
        '**support_text は抜粋から一字一句そのまま引き写してください。**',
        '抜粋に書かれていないことは、正しそうでも書かないでください。',
        '',
        `問い: ${question}`,
        `出典: ${hit.url}`,
        `抜粋: ${hit.snippet}`,
      ].join('\n'),
      z.object({
        claims: z.array(z.object({ claim: z.string(), support_text: z.string() })),
      }),
    );

    return out.claims
      .map((c) => ({ claim: c.claim.trim(), supportText: c.support_text.trim() }))
      .filter((c) => {
        if (c.claim.length === 0 || c.supportText.length === 0) return false;
        // **原文に無い根拠は捨てる。**モデルの言い分ではなく、文字列一致で決める。
        return isGrounded(c.supportText, hit.snippet);
      });
  }

  async synthesize(question: string, claims: readonly string[]): Promise<string[]> {
    if (claims.length === 0) return [];
    const out = await this.#call(
      TOOLS.synthesize,
      [
        '次の根拠だけから導ける結論を、重要な順に最大 5 つ書いてください。',
        '根拠に無いことは書かないでください。断定できないものは断定しないでください。',
        '',
        `問い: ${question}`,
        '根拠:',
        ...claims.map((c, i) => `${i + 1}. ${c}`),
      ].join('\n'),
      z.object({ conclusions: z.array(z.string()) }),
    );
    return out.conclusions.map((c) => c.trim()).filter((c) => c.length > 0);
  }

  async detectContradictions(
    claims: readonly string[],
  ): Promise<{ left: number; right: number }[]> {
    if (claims.length < 2) return [];
    const out = await this.#call(
      TOOLS.contradictions,
      [
        '次の主張のうち、互いに両立しない組を挙げてください。',
        '言い方が違うだけのものは矛盾ではありません。',
        '',
        ...claims.map((c, i) => `${i}. ${c}`),
      ].join('\n'),
      z.object({
        pairs: z.array(z.object({ left: z.number().int(), right: z.number().int() })),
      }),
    );

    // 範囲外・自己参照は捨てる。番号を作り話されても壊れないようにする。
    return out.pairs.filter(
      (p) =>
        p.left !== p.right &&
        p.left >= 0 &&
        p.right >= 0 &&
        p.left < claims.length &&
        p.right < claims.length,
    );
  }

  // ------------------------------------------------------------- internals

  async #call<T>(tool: ToolSpec, prompt: string, schema: z.ZodType<T>): Promise<T> {
    let lastError: unknown;
    for (let attempt = 0; attempt <= this.#retries; attempt += 1) {
      try {
        const response = await this.#fetch(`${this.#baseUrl}/v1/messages`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-api-key': this.#apiKey,
            'anthropic-version': API_VERSION,
          },
          body: JSON.stringify({
            model: this.#model,
            max_tokens: this.#maxTokens,
            // tool を必ず使わせる。自由文で返させると毎回パースが割れる。
            tools: [tool],
            tool_choice: { type: 'tool', name: tool.name },
            messages: [{ role: 'user', content: prompt }],
          }),
        });

        if (!response.ok) {
          const body = await response.text().catch(() => '');
          throw new Error(`anthropic responded ${response.status}: ${body.slice(0, 200)}`);
        }

        const parsed = MessageResponse.parse(await response.json());
        const use = parsed.content.find(
          (block): block is z.infer<typeof ToolUse> =>
            block.type === 'tool_use' && (block as { name?: string }).name === tool.name,
        );
        if (!use) throw new Error(`anthropic did not call ${tool.name}`);
        return schema.parse(use.input);
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  }
}

/**
 * 引き写しが原文にあるか。
 *
 * 完全一致だけを見ると、全角空白の潰れや前後の句読点で落ちる。
 * 空白を無視した比較にする一方、**言い換えは通さない**。
 */
export function isGrounded(supportText: string, snippet: string): boolean {
  const strip = (s: string) => s.replace(/[\s　]+/g, '');
  const needle = strip(supportText);
  if (needle.length === 0) return false;
  return strip(snippet).includes(needle);
}
