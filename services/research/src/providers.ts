/**
 * 外部依存の境界。Phase 2 実装仕様 §1.1。
 *
 * LLM プロバイダは未決（Phase 0 §18 OQ-3）。決まるまで待つと Phase 2 が丸ごと止まるので、
 * Phase 0 の `TokenVerifier` と同じ手を使う: interface を切り、決定的な実装で先へ進める。
 *
 * **モデルに依存しない部分は本物を作る。**品質評価・重複排除・矛盾検出・
 * Evidence Ledger・レポートの組み立ては、モデルが無くても成立する。
 */

export type SourceType = 'official' | 'filing' | 'news' | 'internal' | 'other';

export interface SearchHit {
  readonly url: string;
  readonly title: string;
  /** 検索結果の抜粋。本文の取得は fetch 側の責務。 */
  readonly snippet: string;
  readonly publisher: string | null;
  readonly publishedAt: string | null;
  readonly sourceType: SourceType;
}

export interface SearchProvider {
  readonly name: string;
  search(query: string, limit: number): Promise<SearchHit[]>;
}

export interface ExtractedClaim {
  readonly claim: string;
  /** 抜粋のどこを根拠にしたか。原文全体は object store 側に置く。 */
  readonly supportText: string;
}

export interface LanguageModel {
  readonly name: string;
  /** 質問を、独立に検索できる下位クエリへ分解する。 */
  decompose(question: string, max: number): Promise<string[]>;
  /** 抜粋から、確認できる主張を取り出す。 */
  extractClaims(question: string, hit: SearchHit): Promise<ExtractedClaim[]>;
  /** 根拠から結論をまとめる。 */
  synthesize(question: string, claims: readonly string[]): Promise<string[]>;
  /**
   * 意味の矛盾を見つける。
   *
   * 数値の食い違いは `quality.findContradictions` が規則で拾う。
   * 否定や言い換えを跨ぐものは規則では確実に拾えないので、ここに置いてある。
   * 実装が無い間は「見つからない」ではなく「**まだ調べていない**」であることを、
   * 呼び出し側が扱えるように optional にしてある。
   */
  detectContradictions?(claims: readonly string[]): Promise<{ left: number; right: number }[]>;
}

/**
 * 決定的な検索。テストと、プロバイダが決まるまでの開発に使う。
 * **本番では使わない**（起動時に拒否する呼び出し側の責務）。
 */
export class StaticSearchProvider implements SearchProvider {
  readonly name = 'static';
  readonly #hits: readonly SearchHit[];

  constructor(hits: readonly SearchHit[]) {
    this.#hits = hits;
  }

  async search(query: string, limit: number): Promise<SearchHit[]> {
    const needle = query.toLowerCase();
    const matched = this.#hits.filter(
      (hit) =>
        hit.title.toLowerCase().includes(needle) || hit.snippet.toLowerCase().includes(needle),
    );
    // 一致が無ければ全部返す。検索の質を試すのはここの役目ではない。
    return (matched.length > 0 ? matched : this.#hits).slice(0, limit);
  }
}

/**
 * 決定的な言語モデル。
 *
 * 実モデルの代わりに、規則で同じことをする。**賢くしない。**
 * ここが賢いと、モデルが無くても動いてしまい、差し替えの必要に気づけなくなる。
 */
export class DeterministicLanguageModel implements LanguageModel {
  readonly name = 'deterministic';

  async decompose(question: string, max: number): Promise<string[]> {
    // 「A と B」「A、B」で割る。割れなければ質問そのもの。
    const parts = question
      .split(/[、,]|\sand\s|\sと\s/)
      .map((part) => part.trim())
      .filter((part) => part.length >= 2);
    return (parts.length > 1 ? parts : [question.trim()]).slice(0, max);
  }

  async extractClaims(_question: string, hit: SearchHit): Promise<ExtractedClaim[]> {
    // 抜粋を文で割り、意味のある長さのものだけを主張として扱う
    return hit.snippet
      .split(/[。.]\s*/)
      .map((sentence) => sentence.trim())
      .filter((sentence) => sentence.length >= 8)
      .slice(0, 5)
      .map((sentence) => ({ claim: sentence, supportText: sentence }));
  }

  async synthesize(_question: string, claims: readonly string[]): Promise<string[]> {
    // 上位の主張をそのまま結論にする。要約はしない（できないので、するふりをしない）
    return claims.slice(0, 3);
  }
}
