/**
 * 「追加する / 外す」のスイッチ。§11。
 *
 * ON にした瞬間に繋がるわけではない。**押すと同意シートが開き、触るデータと許可を見てから**
 * 追加される。だから ON の途中（同意待ち）は `busy` で止めて見せる。
 */
import type { ReactElement } from 'react';

export function AppSwitch({
  name,
  on,
  busy = false,
  disabled = false,
  onChange,
}: {
  name: string;
  on: boolean;
  busy?: boolean;
  disabled?: boolean;
  onChange(next: boolean): void;
}): ReactElement {
  return (
    <button
      type="button"
      role="switch"
      className="astra-switch"
      aria-checked={on}
      aria-label={on ? `${name} を外す` : `${name} を追加`}
      aria-busy={busy}
      disabled={disabled || busy}
      data-on={on ? 'true' : 'false'}
      onClick={(event) => {
        event.stopPropagation();
        onChange(!on);
      }}
    >
      <span className="astra-switch__knob" aria-hidden="true" />
    </button>
  );
}
