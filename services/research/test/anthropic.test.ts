/**
 * Claude を LanguageModel として使うときの取り決め。Phase 2 §1.1（OQ-3）。
 * 実際の API は叩かない。**モデルが破れない保証**だけをここで確かめる。
 */
import { describe, expect, it, vi } from 'vitest';
import { AnthropicLanguageModel, isGrounded } from '../src/anthropic.js';
import type { SearchHit } from '../src/providers.js';

const hit: SearchHit = {
  url: 'https://official.example.com/ir',
  title: 'IR',
  snippet: '当社の売上は 100 億円でした。従業員は 500 人です。',
  publisher: 'Example Inc',
  publishedAt: '2026-08-01T00:00:00.000Z',
  sourceType: 'official',
};

/** tool_use を 1 つ返す偽の API。 */
const respond = (name: string, input: unknown, status = 200) =>
  vi.fn(
    async () =>
      new Response(JSON.stringify({ content: [{ type: 'tool_use', name, input }] }), {
        status,
        headers: { 'content-type': 'application/json' },
      }),
  );

const model = (fetch: ReturnType<typeof respond>) =>
  new AnthropicLanguageModel({ apiKey: 'test-key', fetch, retries: 0 });

describe('the request it sends', () => {
  it('forces the tool so the answer cannot come back as prose', async () => {
    const fetch = respond('record_sub_queries', { queries: ['売上', '従業員数'] });
    await model(fetch).decompose('当社の規模は', 4);

    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.anthropic.com/v1/messages');
    const body = JSON.parse(String(init.body));
    expect(body.tool_choice).toEqual({ type: 'tool', name: 'record_sub_queries' });
    expect((init.headers as Record<string, string>)['anthropic-version']).toBe('2023-06-01');
    // 鍵は本文ではなくヘッダに載る
    expect(String(init.body)).not.toContain('test-key');
  });

  it('refuses to be built without a key', () => {
    expect(() => new AnthropicLanguageModel({ apiKey: '' })).toThrow(/API key/);
  });
});

describe('decompose', () => {
  it('drops blanks and duplicates, and honours the limit', async () => {
    const fetch = respond('record_sub_queries', {
      queries: ['売上', '  ', '売上', '従業員数', '利益', '見通し'],
    });
    expect(await model(fetch).decompose('当社の規模は', 3)).toEqual(['売上', '従業員数', '利益']);
  });

  it('falls back to the original question rather than searching for nothing', async () => {
    const fetch = respond('record_sub_queries', { queries: [] });
    expect(await model(fetch).decompose('当社の規模は', 4)).toEqual(['当社の規模は']);
  });
});

describe('extractClaims', () => {
  it('keeps a claim whose support really appears in the snippet', async () => {
    const fetch = respond('record_claims', {
      claims: [{ claim: '売上は 100 億円', support_text: '売上は 100 億円でした' }],
    });
    const claims = await model(fetch).extractClaims('売上は', hit);
    expect(claims).toEqual([{ claim: '売上は 100 億円', supportText: '売上は 100 億円でした' }]);
  });

  it('throws away support the snippet never said', async () => {
    // ここが Evidence Ledger の防波堤。もっともらしさでは通さない。
    const fetch = respond('record_claims', {
      claims: [
        { claim: '売上は 100 億円', support_text: '売上は 100 億円でした' },
        { claim: '利益は 20 億円', support_text: '利益は 20 億円でした' },
      ],
    });
    const claims = await model(fetch).extractClaims('売上は', hit);
    expect(claims.map((c) => c.claim)).toEqual(['売上は 100 億円']);
  });

  it('tolerates whitespace differences but not paraphrase', () => {
    expect(isGrounded('売上は100億円でした', '当社の 売上は 100 億円でした。')).toBe(true);
    expect(isGrounded('売上はおよそ 100 億円', '売上は 100 億円でした。')).toBe(false);
    expect(isGrounded('', '何か')).toBe(false);
  });
});

describe('synthesize', () => {
  it('does not call the model when there is nothing to conclude from', async () => {
    const fetch = respond('record_conclusions', { conclusions: ['x'] });
    expect(await model(fetch).synthesize('売上は', [])).toEqual([]);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('trims and drops empties', async () => {
    const fetch = respond('record_conclusions', { conclusions: ['  売上は横ばい ', ''] });
    expect(await model(fetch).synthesize('売上は', ['a'])).toEqual(['売上は横ばい']);
  });
});

describe('detectContradictions', () => {
  it('ignores pairs that point outside the list or at themselves', async () => {
    // 番号を作り話されても壊れない
    const fetch = respond('record_contradictions', {
      pairs: [
        { left: 0, right: 1 },
        { left: 0, right: 0 },
        { left: 0, right: 9 },
        { left: -1, right: 1 },
      ],
    });
    expect(await model(fetch).detectContradictions(['a', 'b'])).toEqual([{ left: 0, right: 1 }]);
  });

  it('does not ask when there is nothing to compare', async () => {
    const fetch = respond('record_contradictions', { pairs: [] });
    expect(await model(fetch).detectContradictions(['only one'])).toEqual([]);
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe('when the API misbehaves', () => {
  it('retries once and then gives up loudly', async () => {
    const fetch = vi.fn(async () => new Response('rate limited', { status: 429 }));
    const m = new AnthropicLanguageModel({ apiKey: 'k', fetch, retries: 1 });
    await expect(m.decompose('q', 2)).rejects.toThrow(/429/);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('fails rather than guessing when the tool was not used', async () => {
    const fetch = vi.fn(
      async () =>
        new Response(JSON.stringify({ content: [{ type: 'text', text: 'すみません' }] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    );
    const m = new AnthropicLanguageModel({ apiKey: 'k', fetch, retries: 0 });
    await expect(m.decompose('q', 2)).rejects.toThrow(/did not call/);
  });

  it('fails when the tool input does not match the shape we asked for', async () => {
    const fetch = respond('record_sub_queries', { queries: 'not-a-list' });
    const m = new AnthropicLanguageModel({ apiKey: 'k', fetch, retries: 0 });
    await expect(m.decompose('q', 2)).rejects.toThrow();
  });
});
