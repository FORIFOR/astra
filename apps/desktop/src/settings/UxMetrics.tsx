/** 設定 → 計測。UI/UX §23 の目盛りと、手元で測った値。 */
import { useEffect, useState, type ReactElement } from 'react';
import { resetUxMetrics, subscribeUxMetrics, summarizeUxMetrics } from '../ux/metrics.js';

export function UxMetrics(): ReactElement {
  const [rows, setRows] = useState(summarizeUxMetrics);
  useEffect(() => subscribeUxMetrics(() => setRows(summarizeUxMetrics())), []);
  return (
    <section className="astra-ux-metrics" aria-label="計測">
      <h3 className="astra-menu__title">計測（§23 の目標と、この起動で測った値）</h3>
      <table className="astra-ux-metrics__table">
        <thead>
          <tr>
            <th>項目</th>
            <th>目標 p95</th>
            <th>測定 p95</th>
            <th>直近</th>
            <th>回数</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={row.name}
              data-within={row.withinTarget === null ? 'unknown' : String(row.withinTarget)}
            >
              <td>{row.label}</td>
              <td>&lt; {row.targetMs} ms</td>
              <td>
                {row.p95 === null ? '未計測' : `${row.p95} ms`}
                {row.withinTarget === false && (
                  <span className="astra-ux-metrics__over"> 超過</span>
                )}
              </td>
              <td>{row.last === null ? '—' : `${row.last} ms`}</td>
              <td>{row.count}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <button type="button" className="astra-button astra-button--quiet" onClick={resetUxMetrics}>
        値を消す
      </button>
    </section>
  );
}
