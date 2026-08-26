import type { ReactElement } from 'react';
/**
 * Top bar。UI/UX §7.1（56px: page title / global search / notifications / profile）。
 * UI-0 では title と theme 切替のみ。search と notifications は UI-3 で埋める。
 */
import { TOP_LEVEL_TABS, THEME_MODES, type ThemeMode } from '@astra/ui-kit';
import { useShell } from '../state/ShellProvider.js';
import { useTheme } from '../state/ThemeProvider.js';

const THEME_LABELS: Record<ThemeMode, string> = {
  system: 'システム',
  light: 'ライト',
  dark: 'ダーク',
};

export function TopBar(): ReactElement {
  const { activeTab } = useShell();
  const { mode, setMode } = useTheme();
  const tab = TOP_LEVEL_TABS.find((t) => t.id === activeTab)!;

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
      </div>
    </header>
  );
}
