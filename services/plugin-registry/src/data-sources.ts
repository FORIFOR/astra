/**
 * dashboard の bind を解決する。Phase 4 実装仕様 §3.1（D-33 / D-34）。
 *
 * **plugin に SQL を書かせない。**渡させると、テーブル所有権（§5.1）も
 * RLS も意味を失う。plugin が書けるのは `query` という**名前**だけで、
 * その名前が何を引くかは host 側が決める。
 *
 * さらに、**その名前を実装するのは所有サービス自身**にしてある。
 * registry がよそのテーブルを直接引くと、所有権の規約が崩れる。
 * ここに置くのは合成と、解決できなかったときの扱いだけ。
 *
 * 表に無い名前は解決しない。**0 や空表として描かない**（D-34）。
 * 「データが無い」と「壊れている」を混ぜると、誰も気づけなくなる。
 */
import type { ResolvedValue } from '@astra/contracts';

/** 所有サービスが 1 つの名前に対して提供する引き方。 */
export type DataSourceHandler = (tenantId: string) => Promise<ResolvedValue>;

/** 所有サービスが公開する名前の束。 */
export type DataSourceMap = Readonly<Record<string, DataSourceHandler>>;

export interface DataSourceResolver {
  /** この名前を引けるか。表に無ければ publish を落とすのに使う。 */
  has(query: string): boolean;
  /** 引ける名前の一覧。 */
  readonly names: readonly string[];
  resolve(tenantId: string, query: string): Promise<ResolvedValue>;
}

/**
 * 各サービスの束をひとつにまとめる。名前がぶつかったら**起動時に落とす**。
 * 後勝ちで黙って上書きすると、どちらが引かれているか誰にも分からなくなる。
 */
export function composeDataSources(...maps: readonly DataSourceMap[]): DataSourceResolver {
  const merged = new Map<string, DataSourceHandler>();
  for (const map of maps) {
    for (const [name, handler] of Object.entries(map)) {
      if (merged.has(name)) {
        throw new Error(`two services both provide the data source "${name}"`);
      }
      merged.set(name, handler);
    }
  }

  return {
    names: [...merged.keys()].sort(),
    has: (query) => merged.has(query),
    async resolve(tenantId, query) {
      const handler = merged.get(query);
      if (!handler) {
        // 表に無いものは解決しない。**0 では描かない。**
        return { kind: 'unavailable', reason: `no host query named "${query}"` };
      }
      try {
        return await handler(tenantId);
      } catch (error) {
        return {
          kind: 'unavailable',
          reason: `could not read "${query}": ${
            error instanceof Error ? error.message : 'unknown'
          }`,
        };
      }
    },
  };
}

/** 何も提供されていないとき用。全部 unavailable になる。 */
export const NO_DATA_SOURCES: DataSourceResolver = composeDataSources();
