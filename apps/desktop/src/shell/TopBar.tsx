/**
 * Top bar。UI/UX §7.1（56px: page title / global search / notifications / profile）。
 *
 * 外観の切替と設定は profile の中。top bar に生の select を並べない。
 */
import { useState, type ReactElement } from 'react';
import { TOP_LEVEL_TABS } from '@astra/ui-kit';
import { useShell } from '../state/ShellProvider.js';
import { DeviceCapabilities } from '../settings/DeviceCapabilities.js';
import { ShortcutSettings } from '../settings/ShortcutSettings.js';
import { GlobalSearch } from './GlobalSearch.js';
import { Notifications } from './Notifications.js';
import { ProfileMenu } from './ProfileMenu.js';

export function TopBar(): ReactElement {
  const { activeTab } = useShell();
  const tab = TOP_LEVEL_TABS.find((t) => t.id === activeTab)!;
  // §2.1: 設定でタブを増やさない（AC-12）。top bar から開く面にする。
  const [settingsOpen, setSettingsOpen] = useState(false);

  return (
    <header className="astra-topbar">
      <h1 className="astra-topbar__title">{tab.label}</h1>
      <GlobalSearch />
      <div className="astra-topbar__actions">
        <Notifications />
        <ProfileMenu
          settingsOpen={settingsOpen}
          onToggleSettings={() => setSettingsOpen((open) => !open)}
        />
      </div>
      {settingsOpen && (
        <div className="astra-topbar__panel" role="group" aria-label="設定">
          <div className="astra-topbar__panel-head">
            <h2 className="astra-menu__title">設定</h2>
            <button
              type="button"
              className="astra-menu__item--quiet astra-topbar__panel-close"
              onClick={() => setSettingsOpen(false)}
            >
              閉じる
            </button>
          </div>
          <ShortcutSettings />
          {/* §25: できないことを、黙って落とさない */}
          <DeviceCapabilities />
        </div>
      )}
    </header>
  );
}
