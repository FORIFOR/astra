/**
 * install 前の同意。UI/UX §11.1、Phase 4 実装仕様 §4。
 *
 * **押しただけで権限が付かない。**何に触るのか、どの操作に確認が要るのかを
 * 先に見せ、scope ごとに選ばせる。全部まとめて要求しない（正本 §3 Step 5）。
 */
import { useState, type ReactElement } from 'react';
import type { PluginCatalogEntry } from '@astra/contracts';

export function InstallConsent({
  plugin,
  onCancel,
  onInstall,
}: {
  plugin: PluginCatalogEntry;
  onCancel(): void;
  onInstall(scopes: string[]): void;
}): ReactElement {
  // 既定は**何も許可しない**。押すたびに増える形にする。
  const [granted, setGranted] = useState<ReadonlySet<string>>(new Set());

  const toggle = (scope: string): void =>
    setGranted((current) => {
      const next = new Set(current);
      if (next.has(scope)) next.delete(scope);
      else next.add(scope);
      return next;
    });

  return (
    <form
      className="astra-consent"
      aria-label={`${plugin.name} の追加`}
      onSubmit={(e) => {
        e.preventDefault();
        onInstall([...granted]);
      }}
    >
      <h3>{plugin.name} を追加します</h3>

      <section>
        <h4>触るデータ</h4>
        <ul className="astra-consent__data">
          {plugin.data_accessed.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </section>

      <section>
        <h4>許可</h4>
        {plugin.permissions.length === 0 ? (
          <p>追加の許可は要りません。</p>
        ) : (
          <ul className="astra-consent__scopes">
            {plugin.permissions.map((scope) => (
              <li key={scope}>
                <label>
                  <input
                    type="checkbox"
                    checked={granted.has(scope)}
                    onChange={() => toggle(scope)}
                  />
                  {scope}
                </label>
              </li>
            ))}
          </ul>
        )}
        <p className="astra-consent__note">
          許可しなかったものは、必要になったときに改めて聞きます。
        </p>
      </section>

      <section>
        <h4>実行される場所</h4>
        <p>{plugin.execution_surfaces.join(' / ')}</p>
      </section>

      <div className="astra-consent__actions">
        <button type="button" onClick={onCancel}>
          キャンセル
        </button>
        <button type="submit">追加する</button>
      </div>
    </form>
  );
}
