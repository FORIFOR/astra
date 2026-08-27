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

/** 生の enum を画面に出さない（§6.1）。 */
const SURFACE_LABEL: Record<string, string> = { local: 'この端末', cloud: 'クラウド' };
const PROVIDER_LABEL: Record<string, string> = {
  google: 'Google',
  host: 'この端末',
  salesforce: 'Salesforce',
};
export function providerLabel(provider: string): string {
  return PROVIDER_LABEL[provider] ?? provider;
}
const SIGNATURE_LABEL: Record<PluginCatalogEntry['signature_state'], string> = {
  VERIFIED: '署名を確認済み',
  BUILTIN_TRUSTED: 'Astra 同梱',
  UNSIGNED: '署名なし',
};

export function AppDetail({
  plugin,
  onInstall,
  onUninstall,
  onClose,
}: {
  plugin: PluginCatalogEntry;
  onInstall(): void;
  onUninstall(): void;
  onClose?(): void;
}): ReactElement {
  return (
    <article className="astra-app-detail" aria-label={plugin.name}>
      <header className="astra-app-detail__head">
        <div>
          <h3>{plugin.name}</h3>
          <p className="astra-app-detail__publisher">
            {plugin.publisher}
            {plugin.verified ? <span className="astra-app-detail__verified"> 確認済み</span> : null}
            <span className="astra-app-detail__version"> v{plugin.latest_version}</span>
          </p>
        </div>
        {onClose && (
          <button type="button" className="astra-button astra-button--quiet" onClick={onClose}>
            閉じる
          </button>
        )}
      </header>

      {/* §11.1: 「できる仕事」を先に。tool 数は secondary */}
      <section>
        <h4>できる仕事</h4>
        {plugin.jobs.length === 0 ? (
          <p className="astra-app-detail__empty">提供元が書いていません。</p>
        ) : (
          <ul className="astra-app-detail__jobs">
            {plugin.jobs.map((job) => (
              <li key={job}>{job}</li>
            ))}
          </ul>
        )}
      </section>

      {plugin.connectors.length > 0 && (
        <p className="astra-app-detail__uses">
          <span>Uses:</span> {plugin.connectors.map(providerLabel).join(' · ')}
        </p>
      )}

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
        <dd>{plugin.execution_surfaces.map((s) => SURFACE_LABEL[s] ?? s).join(' / ')}</dd>
        <dt>署名</dt>
        <dd>{SIGNATURE_LABEL[plugin.signature_state]}</dd>
        <dt>更新日</dt>
        <dd>{plugin.updated_at ? new Date(plugin.updated_at).toLocaleDateString('ja-JP') : '—'}</dd>
        <dt>追加される画面</dt>
        <dd>{plugin.dashboards.length === 0 ? 'なし' : plugin.dashboards.join(' / ')}</dd>
        <dt>料金</dt>
        <dd>{plugin.pricing ?? '提供元が公開していません'}</dd>
        <dt>変更点</dt>
        <dd>{plugin.changelog ?? '提供元が公開していません'}</dd>
        {/* tool 数は secondary metadata（UI/UX §11.1） */}
        <dt>道具の数</dt>
        <dd>{plugin.tool_count}</dd>
      </dl>

      {plugin.installed ? (
        <>
          <p className="astra-app-detail__installed">追加済み（v{plugin.installed_version}）</p>
          {/* §11.1 uninstall impact: 消えるものを、消す前に言う */}
          {plugin.removable && (
            <p className="astra-app-detail__impact">
              削除すると
              {plugin.dashboards.length > 0 ? `、画面「${plugin.dashboards.join('」「')}」と` : ''}
              {plugin.connectors.length > 0
                ? `、${plugin.connectors.map(providerLabel).join(' / ')} への接続と`
                : ''}
              この pack が使う許可が外れます。作った成果物は Library に残ります。
            </p>
          )}
          {plugin.removable ? (
            <button
              type="button"
              className="astra-button astra-button--danger"
              onClick={onUninstall}
            >
              削除する
            </button>
          ) : (
            <p className="astra-app-detail__locked">これは中核の機能なので削除できません。</p>
          )}
        </>
      ) : (
        <button type="button" className="astra-button astra-button--primary" onClick={onInstall}>
          追加する
        </button>
      )}
    </article>
  );
}
