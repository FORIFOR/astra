import type { ReactElement } from 'react';
/**
 * ワーク。UI-0 では骨組みのみ。
 * 中身は UI/UX 仕様 §8〜§11 に沿って UI-3 で実装する。
 */
export function WorkPage(): ReactElement {
  return (
    <section className="astra-page" aria-labelledby="astra-page-title">
      <h2 id="astra-page-title" className="astra-visually-hidden">
        ワーク
      </h2>
      <p className="astra-page__placeholder">ワークはまだ空です。</p>
    </section>
  );
}
