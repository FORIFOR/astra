/** サイドバーの線アイコン（15px, stroke 1.7）。参照デザインの Lucide 系に合わせる。 */
import type { ReactElement } from 'react';
import type { TabId } from '@astra/ui-kit';

const common = {
  width: 15,
  height: 15,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.7,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
};

export function NavIcon({ id }: { id: TabId }): ReactElement {
  switch (id) {
    case 'home':
      return (
        <svg {...common}>
          <rect x="3" y="3" width="7" height="9" rx="1.5" />
          <rect x="14" y="3" width="7" height="5" rx="1.5" />
          <rect x="14" y="12" width="7" height="9" rx="1.5" />
          <rect x="3" y="16" width="7" height="5" rx="1.5" />
        </svg>
      );
    case 'work':
      return (
        <svg {...common}>
          <path d="M4 6h16M4 12h10M4 18h13" />
        </svg>
      );
    case 'library':
      return (
        <svg {...common}>
          <path d="M4 5h4v14H4zM10 5h4v14h-4zM16 6l4-1 3 13-4 1z" />
        </svg>
      );
    case 'apps':
      return (
        <svg {...common}>
          <rect x="3" y="3" width="7" height="7" rx="1.5" />
          <rect x="14" y="3" width="7" height="7" rx="1.5" />
          <rect x="3" y="14" width="7" height="7" rx="1.5" />
          <path d="M17.5 14v7M14 17.5h7" />
        </svg>
      );
  }
}
