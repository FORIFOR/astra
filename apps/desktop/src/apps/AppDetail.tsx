/**
 * Plugin の詳細。UI/UX §11.1 の必須項目をすべて出す。
 *
 * **「できる仕事」を先に、tool 数は secondary。**
 * 何個の tool があるかは、利用者が知りたいことではない。
 */
import type { ReactElement } from 'react';
import type { PluginCatalogEntry } from '@astra/contracts';

export function AppDetail({
  plugin,
  onInstall,
  onUninstall,
}: {
  plugin: PluginCatalogEntry;
  onInstall(): void;
  onUninstall(): void;
}): ReactElement {
  return (
    <article className="astra-app-detail" aria-label={plugin.name}>
      <header>
        <h3>{plugin.name}</h3>
        <p className="astra-app-detail__publisher">
          {plugin.publisher}
          {plugin.verified ? <span className="astra-app-detail__verified"> 確認済み</span> : null}
          <span className="astra-app-detail__version"> v{plugin.latest_version}</span>
        </p>
      </header>

      <section>
        <h4>触るデータ</h4>
        <ul>
          {plugin.data_accessed.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </section>

      <section>
        <h4>許可</h4>
        <ul>
          {plugin.permissions.map((scope) => (
            <li key={scope}>{scope}</li>
          ))}
        </ul>
      </section>

      <dl className="astra-app-detail__meta">
        <dt>実行される場所</dt>
        <dd>{plugin.execution_surfaces.join(' / ')}</dd>
        <dt>署名</dt>
        <dd>{plugin.signature_state}</dd>
        {/* tool 数は secondary metadata（UI/UX §11.1） */}
        <dt>tool</dt>
        <dd>{plugin.tool_count}</dd>
      </dl>

      {plugin.installed ? (
        <>
          <p className="astra-app-detail__installed">追加済み（v{plugin.installed_version}）</p>
          {plugin.removable ? (
            <button type="button" onClick={onUninstall}>
              削除する
            </button>
          ) : (
            <p className="astra-app-detail__locked">これは中核の機能なので削除できません。</p>
          )}
        </>
      ) : (
        <button type="button" onClick={onInstall}>
          追加する
        </button>
      )}
    </article>
  );
}
