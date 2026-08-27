import type { ReactElement } from 'react';

/** Dock の中で完結する短い結果面。長文でも full app を強制しない。 */
export function ResultPreview({ text }: { text: string }): ReactElement {
  return (
    <section className="astra-dock-result" aria-label="Astra の回答">
      <header className="astra-dock-result__head">
        <span aria-hidden="true">✦</span>
        <h2>回答</h2>
      </header>
      <div className="astra-dock-result__body">{text}</div>
    </section>
  );
}
