/**
 * アプリのアイコン。§11 の一覧で「何のアプリか」を一目で。
 *
 * 接続先（Gmail / Google Calendar / Finder）は見慣れた形の SVG。
 * それ以外は名前の頭文字を、種類ごとの色のタイルに置く。画像ファイルは持たない。
 */
import type { ReactElement, ReactNode } from 'react';
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

/** 種類が分かる形のタイル。色と線画だけで、画像は持たない。 */
function Tile({ from, to, children }: { from: string; to: string; children: ReactNode }) {
  const id = `g-${from.slice(1)}-${to.slice(1)}`;
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true">
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={from} />
          <stop offset="1" stopColor={to} />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="7" fill={`url(#${id})`} />
      <g fill="none" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        {children}
      </g>
    </svg>
  );
}

const PACKS: Record<string, () => ReactElement> = {
  'com.astra.architecture': () => (
    <Tile from="#3B82F6" to="#1E3A8A">
      <path d="M9 23V11l7-4 7 4v12M9 23h14M13 23v-6h6v6" />
    </Tile>
  ),
  'com.astra.care': () => (
    <Tile from="#F472B6" to="#BE185D">
      <path d="M16 24s-8-4.8-8-10a4 4 0 0 1 8-1.6A4 4 0 0 1 24 14c0 5.2-8 10-8 10z" />
    </Tile>
  ),
  'com.astra.ehr': () => (
    <Tile from="#34D399" to="#047857">
      <path d="M16 9v14M9 16h14" />
    </Tile>
  ),
  'com.astra.meeting': () => (
    <Tile from="#F59E0B" to="#B45309">
      <rect x="12" y="7" width="8" height="12" rx="4" />
      <path d="M9 16a7 7 0 0 0 14 0M16 23v3" />
    </Tile>
  ),
  'com.astra.research': () => (
    <Tile from="#6366F1" to="#312E81">
      <circle cx="14" cy="14" r="6" />
      <path d="M19 19l5 5" />
    </Tile>
  ),
  'com.astra.sales-crm': () => (
    <Tile from="#F97316" to="#9A3412">
      <path d="M8 23l6-6 4 4 6-8M18 13h6v6" />
    </Tile>
  ),
  'com.astra.stock': () => (
    <Tile from="#10B981" to="#064E3B">
      <path d="M8 22V14M13 22v-5M18 22V11M23 22v-8" />
    </Tile>
  ),
  'com.astra.video': () => (
    <Tile from="#8B5CF6" to="#4C1D95">
      <rect x="7" y="11" width="13" height="11" rx="2" />
      <path d="M20 15l5-3v9l-5-3z" />
    </Tile>
  ),
  'com.astra.general': () => (
    <Tile from="#0EA5E9" to="#0C4A6E">
      <path d="M16 8l1.8 5.2L23 15l-5.2 1.8L16 22l-1.8-5.2L9 15l5.2-1.8z" />
    </Tile>
  ),
};

const KNOWN: Record<string, () => ReactElement> = {
  'com.astra.gmail': Gmail,
  'com.astra.google-calendar': GoogleCalendar,
  'com.astra.finder': Finder,
  ...PACKS,
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
