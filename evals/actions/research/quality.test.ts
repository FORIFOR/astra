/**
 * 正本 §25 Research。
 *
 * ここで見たいのは**モデルの賢さではない**。
 * モデルが差し替わっても守られていなければならない性質だけを見る:
 *
 *   - 古い二次情報が、新しさだけで一次情報に勝たない
 *   - 引用が、実際に出典に書かれている
 *   - 食い違いを、片方だけ採って消さない
 *   - 裏付けのない主張を混ぜない
 */
import { describe, expect, it } from 'vitest';
import {
  confidenceOf,
  dedupe,
  findContradictions,
  freshness,
  isGrounded,
  normalizeUrl,
  score,
  sourceQuality,
  type ScoredCandidate,
  type SearchHit,
} from '@astra/service-research';

const NOW = new Date('2026-08-27T00:00:00.000Z');

const hit = (over: Partial<SearchHit> & Pick<SearchHit, 'url' | 'snippet'>): SearchHit => ({
  title: over.url,
  publisher: null,
  publishedAt: '2026-08-01T00:00:00.000Z',
  sourceType: 'news',
  ...over,
});

/** 検索結果を、主張 1 件の候補に落とす。 */
const candidateFrom = (source: SearchHit, claim: string) => ({
  url: source.url,
  claim,
  sourceType: source.sourceType,
  publisher: source.publisher,
  publishedAt: source.publishedAt,
  supportText: source.snippet,
  // 見つけたときの姿。URL が切れても、ここは残る。
  title: source.title,
  snippet: source.snippet,
  provider: 'test',
});

/**
 * 実装が採る順序。**質が先、新しさは同じ質の中での順序**。
 * ここを逆にすると、新しいだけのブログが一次情報を押しのける。
 */
const outranks = (a: ScoredCandidate, b: ScoredCandidate): boolean =>
  a.qualityScore > b.qualityScore ||
  (a.qualityScore === b.qualityScore && a.freshnessScore > b.freshnessScore);

describe('source freshness', () => {
  it('does not let a fresh blog outrank an official filing', () => {
    // 新しいだけの二次情報が、古い一次情報に勝ってはいけない
    const official = score(
      candidateFrom(
        hit({
          url: 'https://official.example.com/ir',
          snippet: '売上は 100 億円',
          sourceType: 'official',
          publishedAt: '2025-01-01T00:00:00.000Z',
        }),
        '売上は 100 億円',
      ),
      NOW,
    );
    const blog = score(
      candidateFrom(
        hit({
          url: 'https://blog.example.com/today',
          snippet: '売上は 300 億円らしい',
          sourceType: 'other',
          publishedAt: NOW.toISOString(),
        }),
        '売上は 300 億円らしい',
      ),
      NOW,
    );

    expect(freshness(blog.publishedAt, NOW)).toBeGreaterThan(freshness(official.publishedAt, NOW));
    expect(sourceQuality(official.sourceType)).toBeGreaterThan(sourceQuality(blog.sourceType));
    // 質が先なので、古い一次情報が勝つ
    expect(outranks(official, blog)).toBe(true);
    expect(outranks(blog, official)).toBe(false);
  });

  it('does not treat an undated source as brand new', () => {
    // 日付が無いものを「今日のもの」として扱うと、古い記事が上に来る
    expect(freshness(null, NOW)).toBeLessThan(freshness(NOW.toISOString(), NOW));
  });

  it('does not treat a future date as extra fresh', () => {
    const future = new Date(NOW.getTime() + 365 * 86_400_000).toISOString();
    expect(freshness(future, NOW)).toBeLessThanOrEqual(freshness(NOW.toISOString(), NOW));
  });
});

describe('citation correctness', () => {
  it('keeps a quote that is actually in the source', () => {
    expect(isGrounded('売上は 100 億円でした', '当社の売上は 100 億円でした。')).toBe(true);
  });

  it('throws away a quote the source never contained', () => {
    // もっともらしさでは通さない
    expect(isGrounded('利益は 20 億円でした', '当社の売上は 100 億円でした。')).toBe(false);
  });

  it('tolerates spacing but not paraphrase', () => {
    expect(isGrounded('売上は100億円', '当社の 売上は 100 億円 でした。')).toBe(true);
    expect(isGrounded('売上はおよそ 100 億円', '売上は 100 億円でした。')).toBe(false);
  });

  it('refuses an empty quote', () => {
    // 空の引用を「根拠あり」と数えない
    expect(isGrounded('', '何か書いてある')).toBe(false);
  });
});

describe('contradiction handling', () => {
  const claims = [
    score(
      candidateFrom(
        hit({ url: 'https://a.example.com', snippet: '売上は 100 億円', sourceType: 'official' }),
        '売上は 100 億円',
      ),
      NOW,
    ),
    score(
      candidateFrom(
        hit({ url: 'https://b.example.com', snippet: '売上は 120 億円', sourceType: 'news' }),
        '売上は 120 億円',
      ),
      NOW,
    ),
  ];

  it('notices two sources giving different numbers', () => {
    expect(findContradictions(claims).length).toBeGreaterThan(0);
  });

  it('does not silently pick the nicer number', () => {
    // 片方だけ採ると、食い違っていたことが消える
    const confidence = confidenceOf(claims, findContradictions(claims));
    expect(confidence).toBe('low');
  });

  it('is confident only when the sources agree and are primary', () => {
    const agreeing = [
      score(
        candidateFrom(
          hit({ url: 'https://a.example.com', snippet: '売上は 100 億円', sourceType: 'official' }),
          '売上は 100 億円',
        ),
        NOW,
      ),
      score(
        candidateFrom(
          hit({ url: 'https://b.example.com', snippet: '売上は 100 億円', sourceType: 'filing' }),
          '売上は 100 億円',
        ),
        NOW,
      ),
    ];
    expect(findContradictions(agreeing)).toEqual([]);
    expect(confidenceOf(agreeing, [])).not.toBe('low');
  });
});

describe('unsupported claims', () => {
  it('counts the same source once, however it was linked to', () => {
    // 同じ出典を二度数えると、裏付けが厚く見える
    const same = [
      score(
        candidateFrom(
          hit({ url: 'https://a.example.com/x?utm_source=news', snippet: '売上は 100 億円' }),
          '売上は 100 億円',
        ),
        NOW,
      ),
      score(
        candidateFrom(
          hit({ url: 'https://a.example.com/x', snippet: '売上は 100 億円' }),
          '売上は 100 億円',
        ),
        NOW,
      ),
    ];
    expect(normalizeUrl(same[0]!.url)).toBe(normalizeUrl(same[1]!.url));
    expect(dedupe(same)).toHaveLength(1);
  });

  it('does not become confident just by repeating one source', () => {
    const repeated = Array.from({ length: 5 }, () =>
      score(
        candidateFrom(
          hit({ url: 'https://a.example.com', snippet: '売上は 100 億円', sourceType: 'other' }),
          '売上は 100 億円',
        ),
        NOW,
      ),
    );
    // 重複を除けば 1 件しかない
    expect(dedupe(repeated)).toHaveLength(1);
    expect(confidenceOf(dedupe(repeated), [])).not.toBe('high');
  });
});
