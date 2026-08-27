/**
 * ピルを押したときのクイックメニュー。通常は閉じていて、押したときだけ開く。
 * 並べるのは実際にできる 3 つだけ（できないものを並べない）。
 */
import { useEffect, useRef, type ReactElement } from 'react';

export function QuickMenu({
  onAsk,
  onListen,
  onRecord,
  onClose,
}: {
  onAsk(): void;
  onListen(): void;
  onRecord(): void;
  onClose(): void;
}): ReactElement {
  const first = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    first.current?.focus();
  }, []);
  return (
    <div className="astra-quick" role="menu" aria-label="Astra に頼む">
      <p className="astra-quick__title">Ask Astra</p>
      <button
        ref={first}
        type="button"
        role="menuitem"
        className="astra-quick__item"
        onClick={onAsk}
      >
        <span aria-hidden="true">⌨</span>
        <span>文字で頼む</span>
      </button>
      <button type="button" role="menuitem" className="astra-quick__item" onClick={onListen}>
        <span aria-hidden="true">🎤</span>
        <span>声で頼む</span>
      </button>
      <button type="button" role="menuitem" className="astra-quick__item" onClick={onRecord}>
        <span aria-hidden="true">●</span>
        <span>会議を記録</span>
      </button>
      <button type="button" className="astra-quick__close" onClick={onClose}>
        閉じる
      </button>
    </div>
  );
}
