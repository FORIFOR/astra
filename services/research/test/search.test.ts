/**
 * 実際に web を引く検索。正本 §8（OQ-3）。
 *
 * 見るのは:
 *   - 選ばれていないものを、勝手に既定にしない
 *   - 提供者が違っても同じ形に揃う
 *   - 「見つからなかった」と「引けなかった」を混ぜない
 */
import { describe, expect, it } from 'vitest';
import {
  BraveSearchProvider,
  GoogleCseSearchProvider,
  SearchError,
  TavilySearchProvider,
  classify,
  searchProviderFromEnv,
  toIsoDate,
} from '../src/search.js';

function respond(
  body: unknown,
  status = 200,
): {
  fetch: typeof globalThis.fetch;
  calls: { url: string; headers: Record<string, string>; body: unknown }[];
} {
  const calls: { url: string; headers: Record<string, string>; body: unknown }[] = [];
  const fetch = (async (url: string, init: RequestInit = {}) => {
    calls.push({
      url,
      headers: (init.headers ?? {}) as Record<string, string>,
      body: init.body ? JSON.parse(init.body as string) : undefined,
    });
    return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status });
  }) as unknown as typeof globalThis.fetch;
  return { fetch, calls };
}

describe('choosing a search provider', () => {
  it('picks nothing when nothing was chosen', () => {
    // 既定を決めない。調べたい内容そのものが問い合わせ先へ渡る。
    expect(searchProviderFromEnv({})).toBeNull();
    expect(searchProviderFromEnv({ BRAVE_SEARCH_API_KEY: 'k' })).toBeNull();
  });

  it('picks nothing when the chosen one has no key', () => {
    expect(searchProviderFromEnv({ ASTRA_SEARCH_PROVIDER: 'brave' })).toBeNull();
    expect(
      searchProviderFromEnv({ ASTRA_SEARCH_PROVIDER: 'google', GOOGLE_SEARCH_API_KEY: 'k' }),
    ).toBeNull();
  });

  it('does not quietly fall back on a name it does not know', () => {
    expect(
      searchProviderFromEnv({ ASTRA_SEARCH_PROVIDER: 'bing', BRAVE_SEARCH_API_KEY: 'k' }),
    ).toBeNull();
  });

  it('picks the one that was chosen and configured', () => {
    expect(
      searchProviderFromEnv({ ASTRA_SEARCH_PROVIDER: 'tavily', TAVILY_API_KEY: 'k' })?.name,
    ).toBe('tavily');
    expect(
      searchProviderFromEnv({
        ASTRA_SEARCH_PROVIDER: 'google',
        GOOGLE_SEARCH_API_KEY: 'k',
        GOOGLE_SEARCH_ENGINE_ID: 'cx',
      })?.name,
    ).toBe('google-cse');
  });

  it('does not use a key meant for another provider', () => {
    expect(
      searchProviderFromEnv({ ASTRA_SEARCH_PROVIDER: 'brave', TAVILY_API_KEY: 'k' }),
    ).toBeNull();
  });
});

describe('Brave', () => {
  it('turns results into the shape everything downstream expects', async () => {
    const { fetch, calls } = respond({
      web: {
        results: [
          {
            url: 'https://www.nikkei.com/article/1',
            title: 'A社の決算',
            description: '売上は 1,204 億円。',
            page_age: '2026-05-14T00:00:00Z',
            profile: { name: '日本経済新聞' },
          },
        ],
      },
    });

    const hits = await new BraveSearchProvider({ apiKey: 'k', fetch }).search('A社 決算', 5);

    expect(calls[0]!.headers['x-subscription-token']).toBe('k');
    expect(hits[0]).toEqual({
      url: 'https://www.nikkei.com/article/1',
      title: 'A社の決算',
      snippet: '売上は 1,204 億円。',
      publisher: '日本経済新聞',
      publishedAt: '2026-05-14T00:00:00.000Z',
      sourceType: 'news',
    });
  });

  it('counts one page once, however many times it appears', async () => {
    const { fetch } = respond({
      web: {
        results: [
          { url: 'https://example.com/a', title: '1', description: 'x' },
          { url: 'https://example.com/a', title: '2', description: 'y' },
          { url: 'https://example.com/b', title: '3', description: 'z' },
        ],
      },
    });
    const hits = await new BraveSearchProvider({ apiKey: 'k', fetch }).search('q', 10);
    expect(hits.map((h) => h.url)).toEqual(['https://example.com/a', 'https://example.com/b']);
  });

  it('returns nothing when there is nothing, without throwing', async () => {
    const { fetch } = respond({ web: { results: [] } });
    expect(await new BraveSearchProvider({ apiKey: 'k', fetch }).search('q', 5)).toEqual([]);
  });
});

describe('Tavily', () => {
  it('does not ask the provider to write the answer', async () => {
    const { fetch, calls } = respond({ results: [] });
    await new TavilySearchProvider({ apiKey: 'k', fetch }).search('q', 5);
    // まとめるのはこちらの仕事。提供者にまとめさせると根拠と結論の区別が消える。
    expect(calls[0]!.body).toMatchObject({ include_answer: false });
  });

  it('reads its own field names', async () => {
    const { fetch } = respond({
      results: [
        {
          url: 'https://www.sec.gov/filing/1',
          title: '10-K',
          content: 'Revenue was $1.2B.',
          published_date: '2026-03-01',
        },
      ],
    });
    const hits = await new TavilySearchProvider({ apiKey: 'k', fetch }).search('q', 5);
    expect(hits[0]).toMatchObject({
      snippet: 'Revenue was $1.2B.',
      sourceType: 'filing',
      publisher: 'sec.gov',
    });
  });
});

describe('Google', () => {
  it('says it is not configured rather than calling without an engine', async () => {
    const { fetch, calls } = respond({});
    await expect(
      new GoogleCseSearchProvider({ apiKey: 'k', fetch }).search('q', 5),
    ).rejects.toMatchObject({ reason: 'not_configured' });
    expect(calls).toEqual([]);
  });

  it('never asks for more than the provider can give', async () => {
    const { fetch, calls } = respond({ items: [] });
    await new GoogleCseSearchProvider({ apiKey: 'k', engineId: 'cx', fetch }).search('q', 50);
    expect(calls[0]!.url).toContain('num=10');
  });
});

describe('when the search cannot be done', () => {
  const cases: { status: number; reason: string }[] = [
    { status: 401, reason: 'unauthorized' },
    { status: 403, reason: 'unauthorized' },
    { status: 429, reason: 'rate_limited' },
    { status: 500, reason: 'provider_error' },
  ];

  for (const { status, reason } of cases) {
    it(`reports ${reason} for ${String(status)}`, async () => {
      const { fetch } = respond({ error: 'no' }, status);
      await expect(
        new BraveSearchProvider({ apiKey: 'k', fetch }).search('q', 5),
      ).rejects.toMatchObject({ reason });
    });
  }

  it('does not read an unreadable reply as "nothing found"', async () => {
    // 引けなかったことを、見つからなかったことにしない
    const { fetch } = respond('<html>gateway error</html>');
    await expect(
      new BraveSearchProvider({ apiKey: 'k', fetch }).search('q', 5),
    ).rejects.toBeInstanceOf(SearchError);
  });

  it('names what to do for every kind of failure', async () => {
    const { fetch } = respond({}, 429);
    try {
      await new BraveSearchProvider({ apiKey: 'k', fetch }).search('q', 5);
    } catch (error) {
      expect((error as SearchError).message.length).toBeGreaterThan(0);
    }
  });
});

describe('guessing what kind of source it is', () => {
  it('recognises governments and schools', () => {
    expect(classify('https://www.meti.go.jp/press/1')).toBe('official');
    expect(classify('https://www.whitehouse.gov/x')).toBe('official');
    expect(classify('https://www.u-tokyo.ac.jp/x')).toBe('official');
  });

  it('recognises filings and investor pages', () => {
    expect(classify('https://www.sec.gov/edgar/1')).toBe('filing');
    expect(classify('https://investor.example.com/results')).toBe('filing');
  });

  it('recognises the press', () => {
    expect(classify('https://www.reuters.com/x')).toBe('news');
    expect(classify('https://www3.nhk.or.jp/news/x')).toBe('news');
  });

  it('says "other" rather than guessing high', () => {
    // ここで official に寄せると、根拠の重みが実際より大きくなる
    expect(classify('https://someblog.example/post')).toBe('other');
    expect(classify('not a url')).toBe('other');
  });
});

describe('dates', () => {
  it('keeps only what it can actually read', () => {
    expect(toIsoDate('2026-05-14')).toBe('2026-05-14T00:00:00.000Z');
    expect(toIsoDate('先週')).toBeNull();
    expect(toIsoDate(undefined)).toBeNull();
    expect(toIsoDate('')).toBeNull();
  });
});
