/**
 * Inspector。UI/UX §7.1（320px、Context / Evidence / Activity / metadata）。
 * §7.2 により、3-column に足りない幅では drawer として重ねる。
 */
import type { ReactNode, ReactElement } from 'react';
import { useShell } from '../state/ShellProvider.js';

export function Inspector({ children }: { children?: ReactNode }): ReactElement | null {
  const { inspectorOpen, layout, setInspectorOpen } = useShell();
  if (!inspectorOpen) return null;

  const asDrawer = layout.inspectorAsDrawer;
  return (
    <aside
      className="astra-inspector"
      data-drawer={asDrawer ? 'true' : 'false'}
      aria-label="インスペクター"
    >
      <div className="astra-inspector__head">
        <h2 className="astra-inspector__title">詳細</h2>
        <button type="button" onClick={() => setInspectorOpen(false)}>
          <span aria-hidden="true">×</span>
          <span className="astra-visually-hidden">インスペクターを閉じる</span>
        </button>
      </div>
      <div className="astra-inspector__body">{children}</div>
    </aside>
  );
}
