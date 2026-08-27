import type { ReactElement } from 'react';
/**
 * Primary sidebar。UI/UX §7.1・§2.1。
 *
 * トップレベルは 4 つ固定。Plugin を入れても増えない（AC-12）。
 */
import { TOP_LEVEL_TABS, type TabId } from '@astra/ui-kit';
import { surfacesFor, type Severity } from '@astra/contracts';
import { useShell } from '../state/ShellProvider.js';
import { useOptionalSession } from '../state/SessionProvider.js';
import { initialOf } from './ProfileMenu.js';
import { useOptionalWorkspaceData } from '../state/WorkspaceData.js';

const ICONS: Record<TabId, string> = {
  home: '◉',
  work: '▤',
  library: '▦',
  apps: '⊞',
};

/**
 * 控えめな印を出す件数。UI/UX §16「Attention → Home + subtle badge」。
 *
 * **数えるのは badge の面を持つ severity だけ。**
 * info は Home に出るが印は付けない。critical は警告で出るので、
 * ここで静かに数えて済ませない。
 */
export function badgeCount(items: readonly { severity: Severity }[]): number {
  return items.filter((item) => surfacesFor(item.severity).includes('badge')).length;
}

export function Sidebar(): ReactElement {
  const { activeTab, goToTab, layout, toggleSidebar } = useShell();
  // shell はデータが無くても成り立つ面。無ければ印を出さないだけ。
  const brief = useOptionalWorkspaceData()?.brief ?? null;
  const me = useOptionalSession()?.me ?? null;
  const collapsed = layout.sidebarCollapsed;
  const badge = brief ? badgeCount([...brief.attention, ...brief.more]) : 0;

  return (
    <nav
      className="astra-sidebar"
      data-collapsed={collapsed ? 'true' : 'false'}
      aria-label="メインナビゲーション"
    >
      <div className="astra-sidebar__brand">
        <span className="astra-sidebar__mark" aria-hidden="true">
          ✦
        </span>
        {!collapsed && <span className="astra-sidebar__wordmark">Astra</span>}
      </div>

      <ul className="astra-sidebar__list">
        {TOP_LEVEL_TABS.map((tab) => {
          const current = tab.id === activeTab;
          return (
            <li key={tab.id}>
              <button
                type="button"
                className="astra-nav-item"
                // §19: 状態を色だけで表さない。aria-current と icon と文字を併用する。
                aria-current={current ? 'page' : undefined}
                data-active={current ? 'true' : 'false'}
                title={collapsed ? `${tab.label} — ${tab.answers}` : tab.answers}
                onClick={() => goToTab(tab.id)}
              >
                <span className="astra-nav-item__icon" aria-hidden="true">
                  {ICONS[tab.id]}
                </span>
                <span className={collapsed ? 'astra-visually-hidden' : 'astra-nav-item__label'}>
                  {tab.label}
                </span>
                {/* §16: 控えめな印。**数を読み上げにも出す**（§19 色だけに頼らない） */}
                {tab.id === 'home' && badge > 0 && (
                  <span className="astra-nav-item__badge">
                    <span aria-hidden="true">{badge}</span>
                    <span className="astra-visually-hidden">気にすべきこと {badge} 件</span>
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ul>

      {/* §7.1: 下部に account。誰として動いているかを、畳んでいても印で残す。 */}
      {me && (
        <div className="astra-sidebar__account" title={` · `}>
          <span className="astra-avatar" aria-hidden="true">
            {initialOf(me.user.display_name)}
          </span>
          {!collapsed && (
            <span className="astra-sidebar__account-names">
              <span className="astra-sidebar__account-name">{me.user.display_name}</span>
              <span className="astra-sidebar__account-tenant">{me.tenant.name}</span>
            </span>
          )}
        </div>
      )}
      <button
        type="button"
        className="astra-sidebar__toggle"
        onClick={toggleSidebar}
        // 幅が足りないときは畳んだまま固定されるので、操作させない
        disabled={layout.mode === 'compact'}
        aria-expanded={!collapsed}
      >
        <span aria-hidden="true" className="astra-sidebar__toggle-glyph">
          {collapsed ? '›' : '‹'}
        </span>
        {/* 畳んだときは幅が無いので、文字は読み上げだけ */}
        <span className={collapsed ? 'astra-visually-hidden' : 'astra-sidebar__toggle-label'}>
          {collapsed ? 'サイドバーを開く' : 'サイドバーをたたむ'}
        </span>
      </button>
    </nav>
  );
}
