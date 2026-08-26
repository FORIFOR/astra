/**
 * Apps タブ。UI/UX §11。
 *
 * 「できる仕事を増やす場所」として見せる。Connector 単体より Pack を先に出す。
 * 追加した plugin の dashboard は**ここに勝手に増える**（Phase 4 Exit）。
 */
import { useCallback, useEffect, useMemo, useState, type ReactElement } from 'react';
import type { AstraClient } from '@astra/api-client';
import type { DashboardView, PluginCatalogEntry } from '@astra/contracts';
import { AppDetail } from '../apps/AppDetail.js';
import { DashboardRenderer } from '../apps/DashboardRenderer.js';
import { InstallConsent } from '../apps/InstallConsent.js';
import '../apps/apps.css';

/** Pack（domain-agent / capability）を先に出す。Connector 単体は後ろ。 */
export function packsFirst(items: readonly PluginCatalogEntry[]): PluginCatalogEntry[] {
  const weight = (p: PluginCatalogEntry): number =>
    p.category === 'domain-agent' ? 0 : p.category === 'capability' ? 1 : 2;
  return [...items].sort((a, b) => weight(a) - weight(b) || a.name.localeCompare(b.name));
}

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
    <section className="astra-page astra-apps" aria-labelledby="astra-page-title">
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

      <section className="astra-apps__catalog" aria-label="追加できるもの">
        <h3>できることを増やす</h3>
        {ordered.length === 0 ? (
          <p className="astra-page__placeholder">追加できるものがありません。</p>
        ) : (
          <ul className="astra-apps__list">
            {ordered.map((plugin) => (
              <li key={plugin.id}>
                <button type="button" onClick={() => setOpenId(plugin.id)}>
                  {plugin.name}
                  {plugin.installed ? <span> · 追加済み</span> : null}
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
        />
      ) : null}
    </section>
  );
}
