/**
 * Context Lens。UI/UX §5。
 *
 * ここに出すのは「今回の依頼で実際に使う / 使った情報」だけ。
 * アクセスできる全データの一覧ではない（§5.2）。この区別が Lens の意味そのもの。
 */
import type { ReactElement } from 'react';
import { chipsFor, type ContextSource } from '@astra/contracts';

const CATEGORY_LABEL: Record<ContextSource['category'], string> = {
  current: '今の画面',
  entity: '相手',
  schedule: '予定',
  internal: '社内',
  external: 'Web',
  policy: '取り扱い',
};

function Chip({
  source,
  onRemove,
  onWhy,
}: {
  source: ContextSource;
  onRemove?: (id: string) => void;
  onWhy?: (id: string) => void;
}): ReactElement {
  const sensitive = source.sensitivity === 'CONFIDENTIAL' || source.sensitivity === 'REGULATED';
  return (
    <span
      className="astra-chip"
      data-sensitive={sensitive ? 'true' : 'false'}
      data-used={source.used ? 'true' : 'false'}
    >
      <span className="astra-chip__category">{CATEGORY_LABEL[source.category]}</span>
      <span className="astra-chip__label">{source.label}</span>
      {/* §5.2: REGULATED / CONFIDENTIAL は色だけでなくラベルでも示す */}
      {sensitive && <span className="astra-chip__flag">{source.sensitivity}</span>}
      {source.reason && onWhy && (
        <button type="button" className="astra-chip__why" onClick={() => onWhy(source.id)}>
          <span aria-hidden="true">?</span>
          <span className="astra-visually-hidden">{source.label} を使う理由</span>
        </button>
      )}
      {source.removable && onRemove && (
        <button type="button" className="astra-chip__remove" onClick={() => onRemove(source.id)}>
          <span aria-hidden="true">×</span>
          <span className="astra-visually-hidden">{source.label} を外す</span>
        </button>
      )}
    </span>
  );
}

export function ContextLens({
  sources,
  expanded,
  onToggle,
  onRemove,
  onWhy,
  explanation,
}: {
  sources: readonly ContextSource[];
  expanded: boolean;
  onToggle(): void;
  onRemove(id: string): void;
  onWhy(id: string): void;
  explanation?: string | null;
}): ReactElement | null {
  if (sources.length === 0) return null;
  const chips = chipsFor(sources);

  return (
    <div className="astra-context" aria-label="この依頼で使う情報">
      <div className="astra-context__row">
        {(expanded ? sources : chips.visible).map((source) => (
          <Chip key={source.id} source={source} onRemove={onRemove} onWhy={onWhy} />
        ))}
        {!expanded && chips.overflow > 0 && (
          <button type="button" className="astra-context__more" onClick={onToggle}>
            +{chips.overflow}
            <span className="astra-visually-hidden">件の情報をすべて表示</span>
          </button>
        )}
        {expanded && (
          <button type="button" className="astra-context__more" onClick={onToggle}>
            <span aria-hidden="true">−</span>
            <span className="astra-visually-hidden">情報を折りたたむ</span>
          </button>
        )}
      </div>
      {/* §5.2「Why this?」は 1 段だけ説明する。モデル内部の推論は出さない。 */}
      {explanation && <p className="astra-context__why">{explanation}</p>}
    </div>
  );
}
