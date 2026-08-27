import type { ReactElement } from 'react';
import { Response } from '../vendor/deepgram-ui/Response.js';

/** Dock の中で完結する短い結果面。長文でも full app を強制しない。 */
export function ResultPreview({ text }: { text: string }): ReactElement {
  return (
    <section className="astra-dock-result" aria-label="Astra の回答">
      <header className="astra-dock-result__head">
        <span aria-hidden="true">✦</span>
        <h2>回答</h2>
      </header>
      {/* 答えは markdown で来る。Deepgram の Response と同じ軽い描画で、見出し・箇条書きを整える */}
      <div className="astra-dock-result__body">
        <Response>{text}</Response>
      </div>
    </section>
  );
}
