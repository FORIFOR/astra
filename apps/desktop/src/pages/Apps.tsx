import type { ReactElement } from 'react';
/**
 * アプリ。UI-0 では骨組みのみ。
 * 中身は UI/UX 仕様 §8〜§11 に沿って UI-3 で実装する。
 */
export function AppsPage(): ReactElement {
  return (
    <section className="astra-page" aria-labelledby="astra-page-title">
      <h2 id="astra-page-title" className="astra-visually-hidden">
        アプリ
      </h2>
      <p className="astra-page__placeholder">アプリはまだ空です。</p>
    </section>
  );
}
