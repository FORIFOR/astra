import type { ReactElement } from 'react';
/**
 * Primary sidebar。UI/UX §7.1・§2.1。
 *
 * トップレベルは 4 つ固定。Plugin を入れても増えない（AC-12）。
 */
import { TOP_LEVEL_TABS, type TabId } from '@astra/ui-kit';
import { useShell } from '../state/ShellProvider.js';

const ICONS: Record<TabId, string> = {
  home: '◉',
  work: '▤',
  library: '▦',
  apps: '⊞',
};

export function Sidebar(): ReactElement {
  const { activeTab, goToTab, layout, toggleSidebar } = useShell();
  const collapsed = layout.sidebarCollapsed;

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
              </button>
            </li>
          );
        })}
      </ul>

      <button
        type="button"
        className="astra-sidebar__toggle"
        onClick={toggleSidebar}
        // 幅が足りないときは畳んだまま固定されるので、操作させない
        disabled={layout.mode !== 'wide'}
        aria-expanded={!collapsed}
      >
        <span aria-hidden="true">{collapsed ? '›' : '‹'}</span>
        <span className="astra-visually-hidden">
          {collapsed ? 'サイドバーを開く' : 'サイドバーを閉じる'}
        </span>
      </button>
    </nav>
  );
}
