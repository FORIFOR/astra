/**
 * 実際に web を引く検索。正本 §8（OQ-3）。
 *
 * **どの提供者を使うかは決めない。**設定されたものを使う。
 * ここで既定を決めると、利用者が選んでいない先へ問い合わせが飛ぶ —
 * 調べたい内容そのものが、選んでいない会社へ渡る。
 *
 * 3 つとも同じ形（`SearchHit`）に揃える。揃えないと、
 * 提供者を替えたときに下流の判定（出典の種類・鮮度）が静かに変わる。
 */
import type { SearchHit, SearchProvider, SourceType } from './providers.js';

/** 引けなかった理由。**種類で扱う。** */
export const SEARCH_FAILURES = [
  'not_configured',
  'unauthorized',
  'rate_limited',
  'timed_out',
  'provider_error',
] as const;
export type SearchFailure = (typeof SEARCH_FAILURES)[number];

export const SEARCH_RECOVERY: Readonly<Record<SearchFailure, string>> = {
  not_configured: '検索サービスが設定されていません。',
  unauthorized: '検索サービスの鍵が受け付けられませんでした。',
  rate_limited: '検索サービスが混み合っています。少し待って試してください。',
  timed_out: '検索サービスが時間内に返しませんでした。',
  provider_error: '検索サービスで問題が起きました。',
};

export class SearchError extends Error {
  readonly reason: SearchFailure;
  constructor(reason: SearchFailure, message?: string) {
    super(message ?? SEARCH_RECOVERY[reason]);
    this.name = 'SearchError';
    this.reason = reason;
  }
}

export type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

export interface WebSearchConfig {
  readonly apiKey: string;
  /** Google だけが要る。検索エンジンの識別子。 */
  readonly engineId?: string;
  readonly fetch?: Fetch;
  readonly timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 10_000;

/**
 * 出典の種類を当てる。
 *
 * **推測であることを隠さない。**判断できないものは `other` にする。
 * ここで `official` に寄せると、根拠の重みが実際より大きくなる。
 */
export function classify(url: string): SourceType {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return 'other';
  }

  /*
   * 開示・提出書類を先に見る。
   *
   * `sec.gov` は `.gov` でもある。政府を先に見ていた間、
   * **提出書類が「政府の発表」として重く数えられていた。**
   * 具体的なものから順に見る。
   */
  if (/(^|\.)(sec\.gov|edinet-fsa\.go\.jp|release\.tdnet\.info)$/.test(host)) return 'filing';
  if (/(^|\.)(investor|ir)\./.test(host)) return 'filing';
  // 政府・規制当局。国ごとの慣行に合わせる
  if (/\.(gov|gov\.[a-z]{2}|go\.jp|gc\.ca|europa\.eu)$/.test(host)) return 'official';
  if (/\.(edu|ac\.[a-z]{2}|ac\.jp)$/.test(host)) return 'official';
  // 報道
  if (/(^|\.)(nikkei|reuters|bloomberg|nytimes|wsj|ft|bbc|asahi|yomiuri|nhk)\./.test(host)) {
    return 'news';
  }
  return 'other';
}

/** 日付らしきものだけ ISO にする。**読めないものは null。** */
export function toIsoDate(value: unknown): string | null {
  if (typeof value !== 'string' || value.length === 0) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
}

async function getJson(url: string, init: RequestInit, config: WebSearchConfig): Promise<unknown> {
  const doFetch = config.fetch ?? globalThis.fetch;
  let response: Response;
  try {
    response = await doFetch(url, {
      ...init,
      signal: AbortSignal.timeout(config.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    });
  } catch (error) {
    throw new SearchError('timed_out', error instanceof Error ? error.message : String(error));
  }

  if (response.status === 401 || response.status === 403) throw new SearchError('unauthorized');
  if (response.status === 429) throw new SearchError('rate_limited');
  if (!response.ok) {
    throw new SearchError('provider_error', `the search provider replied ${response.status}`);
  }

  try {
    return (await response.json()) as unknown;
  } catch {
    // 読めない返事を「見つからなかった」にしない
    throw new SearchError('provider_error', 'the search provider sent a reply we could not read');
  }
}

/** 同じ URL は 1 つに畳む。**同じページを 3 回引いて「3 sources」にしない。** */
function dedupe(hits: readonly SearchHit[], limit: number): SearchHit[] {
  const seen = new Set<string>();
  const out: SearchHit[] = [];
  for (const hit of hits) {
    if (hit.url.length === 0 || seen.has(hit.url)) continue;
    seen.add(hit.url);
    out.push(hit);
    if (out.length >= limit) break;
  }
  return out;
}

/** Brave Search API。 */
export class BraveSearchProvider implements SearchProvider {
  readonly name = 'brave';
  readonly isStandIn = false;
  readonly #config: WebSearchConfig;

  constructor(config: WebSearchConfig) {
    this.#config = config;
  }

  async search(query: string, limit: number): Promise<SearchHit[]> {
    const params = new URLSearchParams({ q: query, count: String(Math.min(limit, 20)) });
    const body = (await getJson(
      `https://api.search.brave.com/res/v1/web/search?${params.toString()}`,
      {
        headers: {
          accept: 'application/json',
          'x-subscription-token': this.#config.apiKey,
        },
      },
      this.#config,
    )) as { web?: { results?: Record<string, unknown>[] } };

    return dedupe(
      (body.web?.results ?? []).map((row) => {
        const url = String(row['url'] ?? '');
        return {
          url,
          title: String(row['title'] ?? ''),
          snippet: String(row['description'] ?? ''),
          publisher:
            typeof row['profile'] === 'object' && row['profile'] !== null
              ? String((row['profile'] as { name?: unknown }).name ?? hostOf(url) ?? '')
              : hostOf(url),
          publishedAt: toIsoDate(row['page_age'] ?? row['age']),
          sourceType: classify(url),
        };
      }),
      limit,
    );
  }
}

/** Tavily Search API。 */
export class TavilySearchProvider implements SearchProvider {
  readonly name = 'tavily';
  readonly isStandIn = false;
  readonly #config: WebSearchConfig;

  constructor(config: WebSearchConfig) {
    this.#config = config;
  }

  async search(query: string, limit: number): Promise<SearchHit[]> {
    const body = (await getJson(
      'https://api.tavily.com/search',
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${this.#config.apiKey}`,
        },
        body: JSON.stringify({
          query,
          max_results: Math.min(limit, 20),
          // 要約は頼まない。**まとめるのはこちらの仕事**で、
          // 提供者にまとめさせると、根拠と結論の区別がつかなくなる。
          include_answer: false,
        }),
      },
      this.#config,
    )) as { results?: Record<string, unknown>[] };

    return dedupe(
      (body.results ?? []).map((row) => {
        const url = String(row['url'] ?? '');
        return {
          url,
          title: String(row['title'] ?? ''),
          snippet: String(row['content'] ?? ''),
          publisher: hostOf(url),
          publishedAt: toIsoDate(row['published_date']),
          sourceType: classify(url),
        };
      }),
      limit,
    );
  }
}

/** Google Programmable Search（Custom Search JSON API）。 */
export class GoogleCseSearchProvider implements SearchProvider {
  readonly name = 'google-cse';
  readonly isStandIn = false;
  readonly #config: WebSearchConfig;

  constructor(config: WebSearchConfig) {
    this.#config = config;
  }

  async search(query: string, limit: number): Promise<SearchHit[]> {
    if (!this.#config.engineId) {
      throw new SearchError('not_configured', 'the Google search engine id is missing');
    }
    const params = new URLSearchParams({
      key: this.#config.apiKey,
      cx: this.#config.engineId,
      q: query,
      // Google は 1 回に 10 件まで
      num: String(Math.min(limit, 10)),
    });
    const body = (await getJson(
      `https://customsearch.googleapis.com/customsearch/v1?${params.toString()}`,
      { headers: { accept: 'application/json' } },
      this.#config,
    )) as { items?: Record<string, unknown>[] };

    return dedupe(
      (body.items ?? []).map((row) => {
        const url = String(row['link'] ?? '');
        const meta = (row['pagemap'] as { metatags?: Record<string, unknown>[] } | undefined)
          ?.metatags?.[0];
        return {
          url,
          title: String(row['title'] ?? ''),
          snippet: String(row['snippet'] ?? ''),
          publisher: String(row['displayLink'] ?? hostOf(url) ?? ''),
          publishedAt: toIsoDate(meta?.['article:published_time'] ?? meta?.['date']),
          sourceType: classify(url),
        };
      }),
      limit,
    );
  }
}

export interface SearchEnv {
  readonly ASTRA_SEARCH_PROVIDER?: string | undefined;
  readonly BRAVE_SEARCH_API_KEY?: string | undefined;
  readonly TAVILY_API_KEY?: string | undefined;
  readonly GOOGLE_SEARCH_API_KEY?: string | undefined;
  readonly GOOGLE_SEARCH_ENGINE_ID?: string | undefined;
}

/** 何を設定すれば繋がるか。**設定名まで言う。** */
export const SEARCH_SETTINGS =
  'ASTRA_SEARCH_PROVIDER=brave|tavily|google と、対応する鍵（BRAVE_SEARCH_API_KEY / TAVILY_API_KEY / GOOGLE_SEARCH_API_KEY + GOOGLE_SEARCH_ENGINE_ID）';

/**
 * 設定から検索を組む。**選ばれていなければ null。**
 *
 * 既定を決めないのは、調べたい内容そのものが問い合わせ先へ渡るから。
 * 「とりあえずどれか」で送ってよい情報ではない。
 */
export function searchProviderFromEnv(env: SearchEnv, fetch?: Fetch): SearchProvider | null {
  const chosen = env.ASTRA_SEARCH_PROVIDER?.trim().toLowerCase();
  if (!chosen) return null;

  const base = (apiKey: string, engineId?: string): WebSearchConfig => ({
    apiKey,
    ...(engineId ? { engineId } : {}),
    ...(fetch ? { fetch } : {}),
  });

  switch (chosen) {
    case 'brave':
      return env.BRAVE_SEARCH_API_KEY
        ? new BraveSearchProvider(base(env.BRAVE_SEARCH_API_KEY))
        : null;
    case 'tavily':
      return env.TAVILY_API_KEY ? new TavilySearchProvider(base(env.TAVILY_API_KEY)) : null;
    case 'google':
      return env.GOOGLE_SEARCH_API_KEY && env.GOOGLE_SEARCH_ENGINE_ID
        ? new GoogleCseSearchProvider(base(env.GOOGLE_SEARCH_API_KEY, env.GOOGLE_SEARCH_ENGINE_ID))
        : null;
    default:
      // 知らない名前を、黙って既定へ落とさない
      return null;
  }
}
