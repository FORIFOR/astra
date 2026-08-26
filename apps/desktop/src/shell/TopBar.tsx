import type { ReactElement } from 'react';
/**
 * Top bar。UI/UX §7.1（56px: page title / global search / notifications / profile）。
 * UI-0 では title と theme 切替のみ。search と notifications は UI-3 で埋める。
 */
import { useState } from 'react';
import { TOP_LEVEL_TABS, THEME_MODES, type ThemeMode } from '@astra/ui-kit';
import { useShell } from '../state/ShellProvider.js';
import { useTheme } from '../state/ThemeProvider.js';
import { ShortcutSettings } from '../settings/ShortcutSettings.js';

const THEME_LABELS: Record<ThemeMode, string> = {
  system: 'システム',
  light: 'ライト',
  dark: 'ダーク',
};

export function TopBar(): ReactElement {
  const { activeTab } = useShell();
  const { mode, setMode } = useTheme();
  const tab = TOP_LEVEL_TABS.find((t) => t.id === activeTab)!;
  // §2.1: 設定でタブを増やさない（AC-12）。top bar から開く面にする。
  const [settingsOpen, setSettingsOpen] = useState(false);

  return (
    <header className="astra-topbar">
      <h1 className="astra-topbar__title">{tab.label}</h1>
      <div className="astra-topbar__actions">
        <label className="astra-topbar__theme">
          <span className="astra-visually-hidden">外観</span>
          <select
            value={mode}
            onChange={(event) => setMode(event.target.value as ThemeMode)}
            aria-label="外観"
          >
            {THEME_MODES.map((option) => (
              <option key={option} value={option}>
                {THEME_LABELS[option]}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className="astra-topbar__settings"
          aria-expanded={settingsOpen}
          onClick={() => setSettingsOpen((open) => !open)}
        >
          設定
        </button>
      </div>
      {settingsOpen && (
        <div className="astra-topbar__panel" role="group" aria-label="設定">
          <ShortcutSettings />
        </div>
      )}
    </header>
  );
}
