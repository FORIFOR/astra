/**
 * 通知。UI/UX §7.1 の top bar 右、§16「静かな割り込み」。
 *
 * 出すのは server が組んだ brief（今日気にすべきこと）だけ。
 * ここで別の通知を作らない — 印の数と Home の件数が食い違うと信用を失う。
 */
import { useEffect, useRef, useState, type ReactElement } from 'react';
import type { BriefItem } from '@astra/contracts';
import { useShell } from '../state/ShellProvider.js';
import { useOptionalWorkspaceData } from '../state/WorkspaceData.js';
import { badgeCount } from './Sidebar.js';

export function Notifications(): ReactElement {
  const { openTask, openArtifact } = useShell();
  const brief = useOptionalWorkspaceData()?.brief ?? null;
  const items: readonly BriefItem[] = brief ? [...brief.attention, ...brief.more] : [];
  const count = badgeCount(items);
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);

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

  const go = (item: BriefItem): void => {
    if (item.target.kind === 'task') openTask(item.target.task_id);
    else if (item.target.kind === 'artifact') openArtifact(item.target.artifact_id);
    setOpen(false);
  };

  return (
    <div className="astra-notify" ref={root}>
      <button
        type="button"
        className="astra-topbar__icon-button"
        aria-label={count > 0 ? `通知 ${count} 件` : '通知'}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <path
            d="M8 2a3.5 3.5 0 0 0-3.5 3.5V8l-1.2 2.4a.5.5 0 0 0 .45.7h8.5a.5.5 0 0 0 .45-.7L11.5 8V5.5A3.5 3.5 0 0 0 8 2Z"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinejoin="round"
          />
          <path d="M6.5 13a1.5 1.5 0 0 0 3 0" fill="none" stroke="currentColor" strokeWidth="1.4" />
        </svg>
        {/* §19: 数を文字でも持つ（色だけに頼らない） */}
        {count > 0 && (
          <span className="astra-topbar__badge" aria-hidden="true">
            {count}
          </span>
        )}
      </button>
      {open && (
        <div
          className="astra-menu astra-notify__panel"
          role="dialog"
          aria-label="今日気にすべきこと"
        >
          <h2 className="astra-menu__title">今日気にすべきこと</h2>
          {items.length === 0 ? (
            <p className="astra-menu__empty">静かです。いま気にすることはありません。</p>
          ) : (
            <ul className="astra-notify__list">
              {items.map((item) => (
                <li key={item.id}>
                  <button type="button" className="astra-notify__item" onClick={() => go(item)}>
                    <span className="astra-notify__item-title">{item.title}</span>
                    {item.detail && (
                      <span className="astra-notify__item-detail">{item.detail}</span>
                    )}
                    <span className="astra-notify__item-action">{item.action_label}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
