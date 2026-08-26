/**
 * Plugin が持ち込んだ dashboard を描く。正本 §14.1、Phase 4 実装仕様 §1.2。
 *
 * **plugin のコードを実行しない。**plugin が書けるのは
 * 「どの component に、どのデータを結ぶか」だけで、描くのはここ。
 * これで plugin が Core UI を壊せない。
 */
import type { ReactElement } from 'react';
import type { DashboardItem, DashboardView, ResolvedValue } from '@astra/contracts';

export function DashboardRenderer({
  view,
  onAction,
}: {
  view: DashboardView;
  onAction?(tool: string): void;
}): ReactElement {
  return (
    <section
      className="astra-dashboard"
      data-layout={view.schema.layout}
      aria-label={view.schema.title}
    >
      <h3 className="astra-dashboard__title">{view.schema.title}</h3>
      <div className="astra-dashboard__grid">
        {view.schema.items.map((item, index) => (
          <Item
            key={`${item.type}-${item.bind ?? index}`}
            item={item}
            value={item.bind ? view.data[item.bind] : undefined}
            {...(onAction ? { onAction } : {})}
          />
        ))}
      </div>
    </section>
  );
}

function Item({
  item,
  value,
  onAction,
}: {
  item: DashboardItem;
  value: ResolvedValue | undefined;
  onAction?(tool: string): void;
}): ReactElement {
  const body = (): ReactElement => {
    // データが要る component は、まず解決できたかを見る。
    // **解決できないものを 0 や空表で描かない**（D-34）。
    if (item.type !== 'text' && item.type !== 'action-button') {
      if (!value || value.kind === 'unavailable') {
        return (
          <p className="astra-dashboard__unavailable" role="status">
            データを取得できませんでした
            <span className="astra-dashboard__reason">
              {value?.kind === 'unavailable' ? value.reason : `"${item.bind}" が解決できません`}
            </span>
          </p>
        );
      }
    }

    switch (item.type) {
      case 'text':
        // plugin が書けるのは平文だけ。HTML として解釈しない。
        return <p className="astra-dashboard__text">{item.body}</p>;

      case 'action-button':
        return (
          <button type="button" onClick={() => item.tool && onAction?.(item.tool)}>
            {item.title ?? item.tool}
          </button>
        );

      case 'metric':
        return (
          <p className="astra-dashboard__metric">{value!.kind === 'count' ? value!.value : '—'}</p>
        );

      case 'table':
      case 'entity-list':
        return value!.kind === 'rows' ? <Rows value={value!} /> : <Mismatch expected="rows" />;

      case 'chart':
      case 'timeline':
        return value!.kind === 'series' ? (
          <Series value={value!} />
        ) : value!.kind === 'rows' ? (
          <Rows value={value!} />
        ) : (
          <Mismatch expected="series" />
        );

      default:
        // 契約にはあるがまだ描けない component。**黙って飛ばさない。**
        return (
          <p className="astra-dashboard__unsupported" role="status">
            この表示形式（{item.type}）にはまだ対応していません
          </p>
        );
    }
  };

  return (
    <article className="astra-dashboard__item" data-type={item.type} data-span={item.span ?? 12}>
      {item.title ? <h4 className="astra-dashboard__item-title">{item.title}</h4> : null}
      {body()}
    </article>
  );
}

function Rows({ value }: { value: Extract<ResolvedValue, { kind: 'rows' }> }): ReactElement {
  if (value.rows.length === 0) {
    // ここは「解決できた上で空」。壊れているのとは別物として書く。
    return <p className="astra-dashboard__empty">まだありません。</p>;
  }
  return (
    <table className="astra-dashboard__table">
      <thead>
        <tr>
          {value.columns.map((c) => (
            <th key={c}>{c}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {value.rows.map((row, i) => (
          <tr key={i}>
            {row.map((cell, j) => (
              <td key={j}>{cell ?? '—'}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Series({ value }: { value: Extract<ResolvedValue, { kind: 'series' }> }): ReactElement {
  if (value.points.length === 0) return <p className="astra-dashboard__empty">まだありません。</p>;
  const max = Math.max(...value.points.map((p) => p.value), 1);
  return (
    <ul className="astra-dashboard__series">
      {value.points.map((point) => (
        <li key={point.label}>
          <span className="astra-dashboard__series-label">{point.label}</span>
          <span
            className="astra-dashboard__series-bar"
            style={{ ['--astra-bar' as string]: `${Math.round((point.value / max) * 100)}%` }}
            aria-hidden="true"
          />
          <span className="astra-dashboard__series-value">{point.value}</span>
        </li>
      ))}
    </ul>
  );
}

/** 宣言した形と返ってきた形が違う。plugin 側の誤りとして見せる。 */
function Mismatch({ expected }: { expected: string }): ReactElement {
  return (
    <p className="astra-dashboard__unavailable" role="status">
      データの形が合いません（{expected} を期待）
    </p>
  );
}
