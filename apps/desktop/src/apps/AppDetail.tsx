/**
 * Plugin の詳細。UI/UX §11.1 の必須項目をすべて出す。
 *
 * **「できる仕事」を先に、tool 数は secondary。**
 * 何個の tool があるかは、利用者が知りたいことではない。
 */
import type { ReactElement } from 'react';
import {
  DATA_HANDLING_DETAIL,
  DATA_HANDLING_LABEL,
  EXTERNAL_SEND_SCOPES,
  LOCAL_ONLY_SCOPES,
  PERMISSION_SCOPE_LABEL,
  type DataHandling,
  type PermissionScope,
  type PluginCatalogEntry,
} from '@astra/contracts';

/**
 * この plugin のデータがどこまで出るか。UI/UX §22。
 *
 * **一番外まで出るものに合わせる。**「local でも動きます」と書いて
 * 外へ送ることを黙るのが、いちばん誤解を生む。
 */
function handlingOf(plugin: PluginCatalogEntry): DataHandling {
  const scopes = plugin.permissions as readonly PermissionScope[];
  if (scopes.some((scope) => (EXTERNAL_SEND_SCOPES as readonly string[]).includes(scope))) {
    return 'external_send';
  }
  const staysLocal =
    plugin.execution_surfaces.every((surface) => surface === 'local') &&
    scopes.every((scope) => (LOCAL_ONLY_SCOPES as readonly string[]).includes(scope));
  return staysLocal ? 'local_only' : 'cloud_used';
}

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
            <li key={scope}>
              {PERMISSION_SCOPE_LABEL[scope] ?? scope}
              {/* §22: 外へ出るものは、外へ出ると言う */}
              {(EXTERNAL_SEND_SCOPES as readonly string[]).includes(scope) && (
                <span className="astra-app-detail__external"> — 外部へ送ります</span>
              )}
            </li>
          ))}
        </ul>
      </section>

      <dl className="astra-app-detail__meta">
        {/* §22: local-only / cloud-used / external-send を短い言葉で出す */}
        <dt>データの扱い</dt>
        <dd>
          <span className="astra-app-detail__handling">
            {DATA_HANDLING_LABEL[handlingOf(plugin)]}
          </span>
          <span className="astra-app-detail__handling-why">
            {DATA_HANDLING_DETAIL[handlingOf(plugin)]}
          </span>
        </dd>
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
