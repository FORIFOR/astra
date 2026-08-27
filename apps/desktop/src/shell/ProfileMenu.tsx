/**
 * Profile。UI/UX §7.1 の top bar 右端。
 *
 * 「誰として動いているか」を常に見せる（§22: 共有の相手を間違えない土台）。
 * 外観と設定はここに畳む。§2.1 の 4 タブに「設定」を足さないため。
 */
import { useEffect, useRef, useState, type ReactElement } from 'react';
import { THEME_MODES, type ThemeMode } from '@astra/ui-kit';
import { useOptionalSession } from '../state/SessionProvider.js';
import { useTheme } from '../state/ThemeProvider.js';

const THEME_LABELS: Record<ThemeMode, string> = {
  system: 'システム',
  light: 'ライト',
  dark: 'ダーク',
};

export function initialOf(name: string | null | undefined): string {
  const trimmed = (name ?? '').trim();
  return trimmed.length > 0 ? [...trimmed][0]!.toUpperCase() : '?';
}

export function ProfileMenu({
  settingsOpen,
  onToggleSettings,
}: {
  settingsOpen: boolean;
  onToggleSettings(): void;
}): ReactElement {
  const session = useOptionalSession();
  const { mode, setMode } = useTheme();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const name = session?.me?.user.display_name ?? null;
  const email = session?.me?.user.email ?? null;
  const tenant = session?.me?.tenant.name ?? null;

  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent): void => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className="astra-profile" ref={root}>
      <button
        type="button"
        className="astra-profile__button"
        aria-label={name ? `アカウント: ${name}` : 'アカウント'}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="astra-avatar" aria-hidden="true">
          {initialOf(name)}
        </span>
      </button>
      {open && (
        <div className="astra-menu astra-profile__panel" role="dialog" aria-label="アカウント">
          <div className="astra-profile__who">
            <span className="astra-avatar astra-avatar--large" aria-hidden="true">
              {initialOf(name)}
            </span>
            <span className="astra-profile__names">
              <span className="astra-profile__name">{name ?? 'サインインしていません'}</span>
              {email && <span className="astra-profile__email">{email}</span>}
              {tenant && <span className="astra-profile__email">{tenant}</span>}
            </span>
          </div>
          <label className="astra-menu__row">
            <span>外観</span>
            <select
              value={mode}
              aria-label="外観"
              onChange={(event) => setMode(event.target.value as ThemeMode)}
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
            className="astra-menu__item"
            aria-expanded={settingsOpen}
            onClick={() => {
              onToggleSettings();
              setOpen(false);
            }}
          >
            設定
          </button>
          {session && (
            <button
              type="button"
              className="astra-menu__item astra-menu__item--quiet"
              onClick={() => {
                setOpen(false);
                void session.signOut();
              }}
            >
              サインアウト
            </button>
          )}
        </div>
      )}
    </div>
  );
}
