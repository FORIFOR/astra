/**
 * source の評価と突き合わせ。正本 §8。Phase 2 実装仕様 §1.1（モデル非依存部分）。
 */
import { describe, expect, it } from 'vitest';
import {
  confidenceOf,
  dedupe,
  findContradictions,
  freshness,
  normalizeClaim,
  normalizeUrl,
  numbersIn,
  score,
  sourceQuality,
  subjectOf,
  type Candidate,
} from '../src/quality.js';

const NOW = new Date('2026-08-26T00:00:00.000Z');

const candidate = (over: Partial<Candidate> & Pick<Candidate, 'url' | 'claim'>): Candidate => ({
  sourceType: 'news',
  publisher: null,
  publishedAt: null,
  supportText: over.claim,
  title: '',
  snippet: '',
  provider: null,
  ...over,
});

describe('source quality', () => {
  it('puts primary sources above secondary ones', () => {
    expect(sourceQuality('official')).toBeGreaterThan(sourceQuality('news'));
    expect(sourceQuality('filing')).toBeGreaterThan(sourceQuality('news'));
    expect(sourceQuality('news')).toBeGreaterThan(sourceQuality('other'));
  });
});

describe('freshness', () => {
  it('decays with age', () => {
    const recent = freshness('2026-08-20T00:00:00.000Z', NOW);
    const old = freshness('2024-08-20T00:00:00.000Z', NOW);
    expect(recent).toBeGreaterThan(old);
    expect(recent).toBeLessThanOrEqual(1);
  });

  it('treats an unknown date as neither good nor bad', () => {
    // 分からないものを新しい扱いにすると、古い記事が上位に来る
    expect(freshness(null, NOW)).toBe(0.5);
    expect(freshness('not-a-date', NOW)).toBe(0.5);
  });
});

describe('url normalisation', () => {
  it('collapses the differences that do not change the page', () => {
    const forms = [
      'https://example.com/a/b',
      'https://example.com/a/b/',
      'https://www.example.com/a/b',
      'https://example.com/a/b#section',
      'https://example.com/a/b?utm_source=x&utm_medium=y',
    ];
    const normalized = new Set(forms.map(normalizeUrl));
    expect(normalized.size).toBe(1);
  });

  it('keeps a query that actually selects the page', () => {
    expect(normalizeUrl('https://example.com/doc?id=7')).toContain('id=7');
  });

  it('leaves something unusable alone rather than throwing', () => {
    expect(normalizeUrl('not a url')).toBe('not a url');
  });
});

describe('dedupe', () => {
  it('keeps one entry per source and claim', () => {
    const scored = [
      candidate({ url: 'https://example.com/a', claim: '売上は 100 億円' }),
      candidate({ url: 'https://www.example.com/a/', claim: '売上は 100 億円。' }),
    ].map((c) => score(c, NOW));
    expect(dedupe(scored)).toHaveLength(1);
  });

  it('keeps the better source when the same claim appears twice', () => {
    const scored = [
      candidate({ url: 'https://example.com/a', claim: 'x が起きた', sourceType: 'news' }),
      candidate({ url: 'https://example.com/a', claim: 'x が起きた', sourceType: 'official' }),
    ].map((c) => score(c, NOW));
    expect(dedupe(scored)[0]?.sourceType).toBe('official');
  });

  it('does not merge different claims from the same page', () => {
    const scored = [
      candidate({ url: 'https://example.com/a', claim: '売上は 100 億円' }),
      candidate({ url: 'https://example.com/a', claim: '社員は 500 人' }),
    ].map((c) => score(c, NOW));
    expect(dedupe(scored)).toHaveLength(2);
  });
});

describe('contradictions', () => {
  it('finds two sources giving different numbers for the same thing', () => {
    const scored = [
      candidate({ url: 'https://a.example.com/x', claim: '売上は 100 億円でした' }),
      candidate({ url: 'https://b.example.com/y', claim: '売上は 120 億円でした' }),
    ].map((c) => score(c, NOW));
    const found = findContradictions(scored);
    expect(found).toHaveLength(1);
    expect(found[0]?.reason).toBe('numeric');
  });

  it('leaves a semantic contradiction to the language model', () => {
    // 否定や言い換えを跨ぐものは規則では確実に拾えない。
    // 拾えるふりをするより、拾えないと分かっている方が安全。
    const scored = [
      candidate({ url: 'https://a.example.com/x', claim: '来期に上場する予定である' }),
      candidate({ url: 'https://b.example.com/y', claim: '来期に上場する予定はない' }),
    ].map((c) => score(c, NOW));
    expect(findContradictions(scored)).toEqual([]);
  });

  it('ignores claims with no numbers at all', () => {
    const scored = [
      candidate({ url: 'https://a.example.com/x', claim: '市場は拡大している' }),
      candidate({ url: 'https://b.example.com/y', claim: '市場は縮小している' }),
    ].map((c) => score(c, NOW));
    expect(findContradictions(scored)).toEqual([]);
  });

  it('does not call the same page contradicting itself', () => {
    const scored = [
      candidate({ url: 'https://a.example.com/x', claim: '売上は 100 億円でした' }),
      candidate({ url: 'https://a.example.com/x?utm_source=z', claim: '売上は 120 億円でした' }),
    ].map((c) => score(c, NOW));
    expect(findContradictions(scored)).toEqual([]);
  });

  it('leaves unrelated claims alone', () => {
    const scored = [
      candidate({ url: 'https://a.example.com/x', claim: '売上は 100 億円でした' }),
      candidate({ url: 'https://b.example.com/y', claim: '社員は 500 人います' }),
    ].map((c) => score(c, NOW));
    expect(findContradictions(scored)).toEqual([]);
  });

  it('extracts the subject by removing the numbers', () => {
    expect(subjectOf('売上は 100 億円')).toBe(subjectOf('売上は 120 億円'));
    expect(subjectOf('売上は 100 億円')).not.toBe(subjectOf('社員は 100 人'));
  });

  it('reads numbers with separators', () => {
    expect(numbersIn('売上は 1,200 億円、前年は 1,000 億円')).toEqual([1200, 1000]);
  });

  it('normalises the punctuation that would otherwise split a claim in two', () => {
    expect(normalizeClaim('売上は、100億円。')).toBe(normalizeClaim('売上は 100億円'));
  });
});

describe('confidence', () => {
  const scored = (count: number, type: Candidate['sourceType']) =>
    Array.from({ length: count }, (_, i) =>
      score(
        candidate({ url: `https://s${i}.example.com/x`, claim: `主張 ${i}`, sourceType: type }),
        NOW,
      ),
    );

  it('is low with nothing to go on', () => {
    expect(confidenceOf([], [])).toBe('low');
  });

  it('never goes high while something contradicts', () => {
    const items = scored(5, 'official');
    const contradictions = findContradictions([
      score(candidate({ url: 'https://a.example.com/x', claim: '売上は 100 億円' }), NOW),
      score(candidate({ url: 'https://b.example.com/y', claim: '売上は 200 億円' }), NOW),
    ]);
    expect(contradictions.length).toBeGreaterThan(0);
    expect(confidenceOf(items, contradictions)).toBe('low');
  });

  it('needs several independent, strong sources to be high', () => {
    expect(confidenceOf(scored(3, 'official'), [])).toBe('high');
    // 弱い source をいくら積んでも高くしない
    expect(confidenceOf(scored(5, 'other'), [])).toBe('medium');
    expect(confidenceOf(scored(1, 'official'), [])).toBe('low');
  });
});
