/**
 * source の評価と突き合わせ。正本 §8.1・§8.2。
 *
 * **ここは言語モデルを使わない。**規則で決まることを規則で決める。
 * モデルに任せると、同じ入力で違う答えが出て、根拠として使えなくなる。
 */
import type { SearchHit, SourceType } from './providers.js';

/**
 * source 種別の重み。正本 §15 の Evidence 表示（Official / Filings / News / Internal）に対応。
 * 一次情報を上に、二次情報を下に置く。
 */
const TYPE_WEIGHT: Record<SourceType, number> = {
  official: 1,
  filing: 0.95,
  internal: 0.8,
  news: 0.6,
  other: 0.3,
};

export function sourceQuality(type: SourceType): number {
  return TYPE_WEIGHT[type];
}

/** 新しさ。半減期 180 日。日付が分からないものは真ん中に置く（良くも悪くも扱わない）。 */
export function freshness(publishedAt: string | null, now: Date = new Date()): number {
  if (!publishedAt) return 0.5;
  const published = new Date(publishedAt).getTime();
  if (!Number.isFinite(published)) return 0.5;
  const ageDays = Math.max(0, (now.getTime() - published) / (24 * 60 * 60 * 1000));
  return Number(Math.pow(0.5, ageDays / 180).toFixed(2));
}

/**
 * URL を突き合わせ用に正規化する。
 *
 * 追跡パラメータ・フラグメント・末尾スラッシュ・`www.` の違いで
 * 同じページを二重に数えない。
 */
export function normalizeUrl(raw: string): string {
  try {
    const url = new URL(raw);
    url.hash = '';
    url.hostname = url.hostname.replace(/^www\./, '');
    for (const key of [...url.searchParams.keys()]) {
      if (/^(utm_|fbclid|gclid|ref$|source$)/.test(key)) url.searchParams.delete(key);
    }
    const path = url.pathname.replace(/\/+$/, '') || '/';
    const query = url.searchParams.toString();
    return `${url.protocol}//${url.hostname}${path}${query ? `?${query}` : ''}`;
  } catch {
    return raw.trim();
  }
}

/** 主張を突き合わせ用に正規化する。表記ゆれで別物にしない。 */
export function normalizeClaim(claim: string): string {
  return claim
    .toLowerCase()
    .replace(/[、。,.\s]+/g, ' ')
    .trim();
}

export interface Candidate {
  readonly url: string;
  readonly claim: string;
  readonly sourceType: SourceType;
  readonly publisher: string | null;
  readonly publishedAt: string | null;
  readonly supportText: string;
}

export interface ScoredCandidate extends Candidate {
  readonly normalizedUrl: string;
  readonly normalizedClaim: string;
  readonly qualityScore: number;
  readonly freshnessScore: number;
}

export function score(candidate: Candidate, now: Date = new Date()): ScoredCandidate {
  return {
    ...candidate,
    normalizedUrl: normalizeUrl(candidate.url),
    normalizedClaim: normalizeClaim(candidate.claim),
    qualityScore: sourceQuality(candidate.sourceType),
    freshnessScore: freshness(candidate.publishedAt, now),
  };
}

/**
 * 同じ source の同じ主張を一つにまとめる。
 * 残すのは質の高い方（同点なら新しい方）。
 */
export function dedupe(candidates: readonly ScoredCandidate[]): ScoredCandidate[] {
  const best = new Map<string, ScoredCandidate>();
  for (const candidate of candidates) {
    const key = `${candidate.normalizedUrl}|${candidate.normalizedClaim}`;
    const current = best.get(key);
    if (
      !current ||
      candidate.qualityScore > current.qualityScore ||
      (candidate.qualityScore === current.qualityScore &&
        candidate.freshnessScore > current.freshnessScore)
    ) {
      best.set(key, candidate);
    }
  }
  return [...best.values()];
}

export interface Contradiction {
  readonly subject: string;
  readonly left: ScoredCandidate;
  readonly right: ScoredCandidate;
  readonly reason: 'numeric';
}

const NUMBER = /-?\d+(?:[.,]\d+)?/g;

/** 数値を取り出す。桁区切りは無視する。 */
export function numbersIn(text: string): number[] {
  return (text.match(NUMBER) ?? [])
    .map((value) => Number(value.replace(/,/g, '')))
    .filter((value) => Number.isFinite(value));
}

/** 数値を除いた骨組み。「何について言っているか」の粗い鍵にする。 */
export function subjectOf(claim: string): string {
  return normalizeClaim(claim).replace(NUMBER, '#').replace(/\s+/g, ' ').trim();
}

/**
 * 矛盾を見つける。正本 §8.1 の contradiction detection。
 *
 * **ここで見つけられるのは「同じことについて違う数字」だけ。**
 *
 * 否定や言い換えを跨ぐ意味の矛盾は、正規表現では確実に拾えない。
 * 拾えない仕組みを置いて「検出できている」と思わせる方が、
 * 拾えないと分かっている状態より危ない。意味の矛盾は
 * `LanguageModel.detectContradictions` の担当にしてある（Phase 2 実装仕様 §1.1）。
 */
export function findContradictions(candidates: readonly ScoredCandidate[]): Contradiction[] {
  const bySubject = new Map<string, ScoredCandidate[]>();
  for (const candidate of candidates) {
    const subject = subjectOf(candidate.claim);
    // 数字を含まない主張はここでは扱えない
    if (subject.length < 6 || !subject.includes('#')) continue;
    bySubject.set(subject, [...(bySubject.get(subject) ?? []), candidate]);
  }

  const found: Contradiction[] = [];
  for (const [subject, group] of bySubject) {
    for (let i = 0; i < group.length; i += 1) {
      for (let j = i + 1; j < group.length; j += 1) {
        const left = group[i]!;
        const right = group[j]!;
        // 同じページの中の違いは矛盾ではない（文脈が違うだけのことが多い）
        if (left.normalizedUrl === right.normalizedUrl) continue;

        const leftNumbers = numbersIn(left.claim);
        const rightNumbers = numbersIn(right.claim);
        if (
          leftNumbers.length > 0 &&
          leftNumbers.length === rightNumbers.length &&
          leftNumbers.some((value, index) => value !== rightNumbers[index])
        ) {
          found.push({ subject, left, right, reason: 'numeric' });
        }
      }
    }
  }
  return found;
}

export type Confidence = 'low' | 'medium' | 'high';

/**
 * 結論の確信度。UI/UX §15 の L0 表示（source 数 + confidence + 矛盾数）に使う。
 *
 * 矛盾があれば上げない。source が少なくても上げない。
 * **「高い」と言うための条件を厳しくしておく**方が、後で信用を失わない。
 */
export function confidenceOf(
  candidates: readonly ScoredCandidate[],
  contradictions: readonly Contradiction[],
): Confidence {
  if (candidates.length === 0) return 'low';
  if (contradictions.length > 0) return 'low';

  const distinctSources = new Set(candidates.map((c) => c.normalizedUrl)).size;
  const strong = candidates.filter((c) => c.qualityScore >= 0.8).length;

  if (distinctSources >= 3 && strong >= 2) return 'high';
  if (distinctSources >= 2) return 'medium';
  return 'low';
}

/** 検索結果を candidate へ。抜粋から主張を切り出すのはモデルの役目。 */
export function candidateFrom(hit: SearchHit, claim: string, supportText: string): Candidate {
  return {
    url: hit.url,
    claim,
    sourceType: hit.sourceType,
    publisher: hit.publisher,
    publishedAt: hit.publishedAt,
    supportText,
  };
}
