/**
 * Top bar。UI/UX §7.1（56px: page title / global search / notifications / profile）。
 *
 * 外観の切替と設定は profile の中。top bar に生の select を並べない。
 */
import { useEffect, useState, type ReactElement } from 'react';
import { TOP_LEVEL_TABS } from '@astra/ui-kit';
import { useShell } from '../state/ShellProvider.js';
import { DeviceCapabilities } from '../settings/DeviceCapabilities.js';
import { ShortcutSettings } from '../settings/ShortcutSettings.js';
import { UxMetrics } from '../settings/UxMetrics.js';
import { VoiceSettings } from '../settings/VoiceSettings.js';
import { GlobalSearch } from './GlobalSearch.js';
import { Notifications } from './Notifications.js';
import { ProfileMenu } from './ProfileMenu.js';

export function TopBar(): ReactElement {
  const { activeTab } = useShell();
  const tab = TOP_LEVEL_TABS.find((t) => t.id === activeTab)!;
  // §2.1: 設定でタブを増やさない（AC-12）。top bar から開く面にする。
  const [settingsOpen, setSettingsOpen] = useState(false);

  // 検索・通知・プロフィールと同じ作法: Esc で閉じる。タブを移ったら閉じる
  useEffect(() => {
    if (!settingsOpen) return;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setSettingsOpen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [settingsOpen]);
  useEffect(() => {
    setSettingsOpen(false);
  }, [activeTab]);

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
          {/* 音を外へ出すかは、話している最中ではなくここで決める（§25） */}
          <VoiceSettings />
          {/* §25: できないことを、黙って落とさない */}
          <DeviceCapabilities />
          {/* §23: 目標と実測。測っていないものを達成と言わない */}
          <UxMetrics />
        </div>
      )}
    </header>
  );
}
