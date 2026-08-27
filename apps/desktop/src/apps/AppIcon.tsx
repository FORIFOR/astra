/**
 * アプリのアイコン。§11 の一覧で「何のアプリか」を一目で。
 *
 * 接続先（Gmail / Google Calendar / Finder）は見慣れた形の SVG。
 * それ以外は名前の頭文字を、種類ごとの色のタイルに置く。画像ファイルは持たない。
 */
import type { ReactElement } from 'react';
import type { PluginCatalogEntry } from '@astra/contracts';

const KIND_COLOR: Record<PluginCatalogEntry['category'], string> = {
  'domain-agent': '#5B5BD6',
  capability: '#0F766E',
  connector: '#475569',
  'skill-pack': '#B45309',
  'dashboard-extension': '#1D4ED8',
};

function Gmail(): ReactElement {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true">
      <rect width="32" height="32" rx="7" fill="#fff" />
      <path d="M6 10.5v12h4V15l6 4.5 6-4.5v7.5h4v-12L16 17.5 6 10.5z" fill="#EA4335" />
      <path
        d="M6 10.5 16 17.5l10-7V9.2c0-1.3-1.5-2-2.5-1.2L16 13.5 8.5 8C7.5 7.2 6 7.9 6 9.2v1.3z"
        fill="#4285F4"
      />
      <path d="M6 10.5v12h4V15l-4-4.5z" fill="#C5221F" />
      <path d="M26 10.5v12h-4V15l4-4.5z" fill="#34A853" />
    </svg>
  );
}

function GoogleCalendar(): ReactElement {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true">
      <rect width="32" height="32" rx="7" fill="#fff" />
      <rect x="5" y="6" width="22" height="21" rx="3" fill="#4285F4" />
      <rect x="7" y="11" width="18" height="14" rx="1.5" fill="#fff" />
      <text
        x="16"
        y="22"
        textAnchor="middle"
        fontSize="11"
        fontWeight="700"
        fill="#4285F4"
        fontFamily="-apple-system, sans-serif"
      >
        31
      </text>
    </svg>
  );
}

function Finder(): ReactElement {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true">
      <rect width="32" height="32" rx="7" fill="#1E9BF0" />
      <path d="M16 3h9a4 4 0 0 1 4 4v18a4 4 0 0 1-4 4h-9V3z" fill="#fff" fillOpacity="0.92" />
      <path d="M9 12v4M23 12v4" stroke="#1E3A5F" strokeWidth="2" strokeLinecap="round" />
      <path
        d="M8 21c2.5 3 5.5 4 8 4s5.5-1 8-4"
        fill="none"
        stroke="#1E3A5F"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <path d="M16 3v26" stroke="#1E3A5F" strokeWidth="1.2" strokeOpacity="0.5" />
    </svg>
  );
}

const KNOWN: Record<string, () => ReactElement> = {
  'com.astra.gmail': Gmail,
  'com.astra.google-calendar': GoogleCalendar,
  'com.astra.finder': Finder,
};

export function AppIcon({ plugin }: { plugin: PluginCatalogEntry }): ReactElement {
  const Known = KNOWN[plugin.id];
  if (Known) {
    return (
      <span className="astra-app-icon">
        <Known />
      </span>
    );
  }
  const letter = plugin.name.trim().charAt(0).toUpperCase() || '?';
  return (
    <span
      className="astra-app-icon astra-app-icon--mono"
      style={{ background: KIND_COLOR[plugin.category] }}
      aria-hidden="true"
    >
      {letter}
    </span>
  );
}
