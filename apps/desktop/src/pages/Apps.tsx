/**
 * Apps タブ。UI/UX §11。
 *
 * 「できる仕事を増やす場所」として見せる。Connector 単体より Pack を先に出す。
 * 追加した plugin の dashboard は**ここに勝手に増える**（Phase 4 Exit）。
 */
import { useCallback, useEffect, useMemo, useState, type ReactElement } from 'react';
import type { AstraClient } from '@astra/api-client';
import {
  EXTERNAL_SEND_SCOPES,
  type DashboardView,
  type PluginCatalogEntry,
} from '@astra/contracts';
import { AppDetail, providerLabel } from '../apps/AppDetail.js';
import { DashboardRenderer } from '../apps/DashboardRenderer.js';
import { InstallConsent } from '../apps/InstallConsent.js';
import '../apps/apps.css';

/** Pack（domain-agent / capability）を先に出す。Connector 単体は後ろ。 */
export function packsFirst(items: readonly PluginCatalogEntry[]): PluginCatalogEntry[] {
  const weight = (p: PluginCatalogEntry): number =>
    p.category === 'domain-agent' ? 0 : p.category === 'capability' ? 1 : 2;
  return [...items].sort((a, b) => weight(a) - weight(b) || a.name.localeCompare(b.name));
}

/** §11: Connector 単体より Pack。card の肩に「何の種類か」を短く。 */
export const CATEGORY_LABEL: Record<PluginCatalogEntry['category'], string> = {
  'domain-agent': 'パック',
  capability: '機能',
  connector: '接続',
  'skill-pack': 'スキル',
  'dashboard-extension': 'ダッシュボード',
};

export interface DashboardRef {
  readonly plugin_id: string;
  readonly plugin_name: string;
  readonly id: string;
  readonly title: string;
}

export function AppsPage({ client = null }: { client?: AstraClient | null }): ReactElement {
  const [catalog, setCatalog] = useState<readonly PluginCatalogEntry[]>([]);
  const [dashboards, setDashboards] = useState<readonly DashboardRef[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [consenting, setConsenting] = useState<PluginCatalogEntry | null>(null);
  const [view, setView] = useState<DashboardView | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async (): Promise<void> => {
    if (!client) return;
    try {
      const [items, boards] = await Promise.all([client.pluginCatalog(), client.dashboards()]);
      setCatalog(items);
      setDashboards(boards);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, [client]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const ordered = useMemo(() => packsFirst(catalog), [catalog]);
  const open = ordered.find((p) => p.id === openId) ?? null;

  const install = async (scopes: string[]): Promise<void> => {
    if (!client || !consenting) return;
    try {
      await client.installPlugin(consenting.id, {
        version: consenting.latest_version,
        granted_scopes: scopes as never,
      });
      setConsenting(null);
      await reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const showDashboard = async (ref: DashboardRef): Promise<void> => {
    if (!client) return;
    try {
      setView(await client.dashboard(ref.plugin_id, ref.id));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  return (
    <section
      className="astra-page astra-apps"
      aria-labelledby="astra-page-title"
      data-open={open ? 'true' : 'false'}
    >
      <h2 id="astra-page-title" className="astra-visually-hidden">
        アプリ
      </h2>

      {error ? <p role="alert">{error}</p> : null}

      {consenting ? (
        <InstallConsent
          plugin={consenting}
          onCancel={() => setConsenting(null)}
          onInstall={(scopes) => void install(scopes)}
        />
      ) : null}

      {dashboards.length > 0 ? (
        <section className="astra-apps__dashboards" aria-label="ダッシュボード">
          <h3>ダッシュボード</h3>
          <ul>
            {dashboards.map((d) => (
              <li key={`${d.plugin_id}:${d.id}`}>
                <button type="button" onClick={() => void showDashboard(d)}>
                  {d.plugin_name} — {d.title}
                </button>
              </li>
            ))}
          </ul>
          {view ? <DashboardRenderer view={view} /> : null}
        </section>
      ) : null}

      <div className="astra-apps__body">
        <section className="astra-apps__catalog" aria-label="追加できるもの">
          <h3>できることを増やす</h3>
          {ordered.length === 0 ? (
            <p className="astra-page__placeholder">追加できるものがありません。</p>
          ) : (
            <ul className="astra-apps__list">
              {ordered.map((plugin) => (
                <li key={plugin.id}>
                  <button
                    type="button"
                    className="astra-app-card"
                    aria-current={plugin.id === openId ? 'true' : undefined}
                    onClick={() => setOpenId(plugin.id)}
                  >
                    <span className="astra-app-card__kind">{CATEGORY_LABEL[plugin.category]}</span>
                    <span className="astra-app-card__name">
                      {plugin.name}
                      {plugin.installed ? (
                        <span className="astra-app-card__state"> 追加済み</span>
                      ) : null}
                    </span>
                    {/* §11: 触るデータを card で先に見せる。開かないと分からない状態にしない */}
                    {plugin.data_accessed.length > 0 && (
                      <span className="astra-app-card__meta">
                        触るもの: {plugin.data_accessed.slice(0, 2).join(' · ')}
                        {plugin.data_accessed.length > 2
                          ? ` 他${plugin.data_accessed.length - 2}`
                          : ''}
                      </span>
                    )}
                    {/* §11: 確認が要る操作があるなら、それも先に */}
                    {plugin.permissions.some((p) =>
                      (EXTERNAL_SEND_SCOPES as readonly string[]).includes(p),
                    ) && <span className="astra-app-card__meta">確認が要る操作を含みます</span>}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        {open ? (
          <AppDetail
            plugin={open}
            onInstall={() => setConsenting(open)}
            onUninstall={() => {
              void (async () => {
                if (!client) return;
                try {
                  await client.uninstallPlugin(open.id);
                  await reload();
                } catch (cause) {
                  setError(cause instanceof Error ? cause.message : String(cause));
                }
              })();
            }}
            onClose={() => setOpenId(null)}
          />
        ) : null}
      </div>
    </section>
  );
}
