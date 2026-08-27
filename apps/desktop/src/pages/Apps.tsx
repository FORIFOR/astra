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
import { AppIcon } from '../apps/AppIcon.js';
import { AppSwitch } from '../apps/AppSwitch.js';
import { DashboardRenderer } from '../apps/DashboardRenderer.js';
import { InstallConsent } from '../apps/InstallConsent.js';
import '../apps/apps.css';

/** 行の一行説明。できる仕事（jobs）を「・」で繋ぐ。無ければ触るデータ。 */
export function appSummary(plugin: PluginCatalogEntry): string {
  if (plugin.jobs.length > 0) return plugin.jobs.join('・');
  return plugin.data_accessed[0] ?? CATEGORY_LABEL[plugin.category];
}

/** 公式 = Astra が出しているもの。接続先は同梱扱いではない（外せる）が、Astra 署名なら公式。 */
export function isOfficial(plugin: PluginCatalogEntry): boolean {
  return plugin.builtin || plugin.publisher === 'astra';
}

/** おすすめ = 接続先（繋ぐと仕事の幅が一気に広がる）。残りは利用可能。 */
export function splitStore(items: readonly PluginCatalogEntry[]): {
  recommended: PluginCatalogEntry[];
  available: PluginCatalogEntry[];
} {
  const ordered = packsFirst(items);
  return {
    recommended: ordered.filter((p) => p.category === 'connector'),
    available: ordered.filter((p) => p.category !== 'connector'),
  };
}

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
  // 公式 = Astra が出しているもの（同梱の Pack と、Astra 署名の接続先）。カスタム = 手で登録したもの
  const [tab, setTab] = useState<'official' | 'custom'>('official');
  const [busyId, setBusyId] = useState<string | null>(null);

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

  // Esc は「今の面を閉じる」。同意シートも例外にしない
  useEffect(() => {
    if (!consenting) return;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setConsenting(null);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [consenting]);

  const ordered = useMemo(() => packsFirst(catalog), [catalog]);
  const open = ordered.find((p) => p.id === openId) ?? null;
  const official = useMemo(() => splitStore(catalog.filter(isOfficial)), [catalog]);
  const custom = useMemo(() => packsFirst(catalog.filter((p) => !isOfficial(p))), [catalog]);

  const uninstall = async (plugin: PluginCatalogEntry): Promise<void> => {
    if (!client) return;
    setBusyId(plugin.id);
    try {
      await client.uninstallPlugin(plugin.id);
      await reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusyId(null);
    }
  };

  const renderRow = (plugin: PluginCatalogEntry): ReactElement => (
    <li
      key={plugin.id}
      className="astra-store-row"
      aria-current={plugin.id === openId ? 'true' : undefined}
    >
      <button
        type="button"
        className="astra-store-row__main"
        onClick={() => setOpenId(plugin.id)}
        aria-label={`${plugin.name} の詳細`}
      >
        <AppIcon plugin={plugin} />
        <span className="astra-store-row__copy">
          <span className="astra-store-row__name">
            {plugin.name}
            <span className="astra-store-row__kind">{CATEGORY_LABEL[plugin.category]}</span>
            {plugin.permissions.some((p) =>
              (EXTERNAL_SEND_SCOPES as readonly string[]).includes(p),
            ) && (
              <span className="astra-store-row__kind astra-store-row__kind--warn">確認あり</span>
            )}
          </span>
          <span className="astra-store-row__summary">{appSummary(plugin)}</span>
        </span>
      </button>
      <AppSwitch
        name={plugin.name}
        on={plugin.installed}
        busy={busyId === plugin.id || consenting?.id === plugin.id}
        disabled={plugin.installed && !plugin.removable}
        onChange={(next) => {
          if (next) setConsenting(plugin);
          else void uninstall(plugin);
        }}
      />
    </li>
  );

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
        /* 同意は 1 つの判断。画面の真ん中で、他を薄くして聞く（会議の開始確認と同じ作法） */
        <div className="astra-apps__sheet" data-phase="consent">
          <InstallConsent
            plugin={consenting}
            onCancel={() => setConsenting(null)}
            onInstall={(scopes) => void install(scopes)}
          />
        </div>
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
        <section className="astra-store" aria-label="アプリストア">
          <header className="astra-store__head">
            <div className="astra-store__title">
              <svg viewBox="0 0 16 16" aria-hidden="true" className="astra-store__glyph">
                <rect
                  x="1.5"
                  y="1.5"
                  width="5"
                  height="5"
                  rx="1.2"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.3"
                />
                <rect
                  x="9.5"
                  y="1.5"
                  width="5"
                  height="5"
                  rx="1.2"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.3"
                />
                <rect
                  x="1.5"
                  y="9.5"
                  width="5"
                  height="5"
                  rx="1.2"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.3"
                />
                <path
                  d="M12 9.5v5M9.5 12h5"
                  stroke="currentColor"
                  strokeWidth="1.3"
                  strokeLinecap="round"
                />
              </svg>
              <div>
                <h3>アプリストア</h3>
                <p>Astra が仕事で使うアプリを繋ぐ</p>
              </div>
            </div>
            <div className="astra-store__tabs" role="tablist" aria-label="種類">
              <button
                type="button"
                role="tab"
                aria-selected={tab === 'official'}
                className="astra-store__tab"
                onClick={() => setTab('official')}
              >
                公式
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={tab === 'custom'}
                className="astra-store__tab"
                onClick={() => setTab('custom')}
              >
                カスタム
              </button>
            </div>
          </header>

          {tab === 'official' ? (
            official.recommended.length + official.available.length === 0 ? (
              <p className="astra-page__placeholder">追加できるものがありません。</p>
            ) : (
              <>
                {official.recommended.length > 0 && (
                  <section className="astra-store__section" aria-label="おすすめ">
                    <h4>おすすめ</h4>
                    <ul className="astra-store__grid">{official.recommended.map(renderRow)}</ul>
                  </section>
                )}
                {official.available.length > 0 && (
                  <section className="astra-store__section" aria-label="利用可能">
                    <h4>利用可能</h4>
                    <ul className="astra-store__grid">{official.available.map(renderRow)}</ul>
                  </section>
                )}
              </>
            )
          ) : custom.length === 0 ? (
            <div className="astra-store__empty">
              <p>手で登録したアプリはまだありません。</p>
              <p>
                署名済みの plugin.yaml を registry
                に登録すると、ここに並びます。未署名のものは登録できません。
              </p>
            </div>
          ) : (
            <section className="astra-store__section" aria-label="カスタム">
              <ul className="astra-store__grid">{custom.map(renderRow)}</ul>
            </section>
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
