/**
 * Global search。UI/UX §7.1 の top bar 中央、Appendix A「GlobalSearch」。
 *
 * 仕事と成果物を、いま手元にあるものから引く。サーバ検索は持たない —
 * ここで見つからないものは Library の絞り込みで探す。
 */
import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import type { TaskView } from '@astra/api-client';
import type { Artifact } from '@astra/contracts';
import { useShell } from '../state/ShellProvider.js';
import { useOptionalWorkspaceData } from '../state/WorkspaceData.js';
import { typeLabel } from '../pages/Library.js';
import { kindLabel } from '../work/kind.js';

export interface SearchHit {
  readonly kind: 'task' | 'artifact';
  readonly id: string;
  readonly title: string;
  /** 種類や状態。行の右端に薄く出す。 */
  readonly meta: string;
}

const MAX_HITS = 8;

/** 純粋関数。並びは「仕事 → 成果物」、それぞれ新しい順のまま。 */
export function searchWorkspace(
  query: string,
  tasks: readonly TaskView[],
  artifacts: readonly Artifact[],
): readonly SearchHit[] {
  const needle = query.trim().toLowerCase();
  if (needle.length === 0) return [];
  const hits: SearchHit[] = [];
  for (const task of tasks) {
    const title = task.title ?? '';
    if (`${title} ${kindLabel(task.kind)}`.toLowerCase().includes(needle)) {
      hits.push({
        kind: 'task',
        id: task.id,
        title: title || '名前のない仕事',
        meta: kindLabel(task.kind),
      });
    }
  }
  for (const artifact of artifacts) {
    if (`${artifact.title} ${typeLabel(artifact.type)}`.toLowerCase().includes(needle)) {
      hits.push({
        kind: 'artifact',
        id: artifact.id,
        title: artifact.title,
        meta: typeLabel(artifact.type),
      });
    }
  }
  return hits.slice(0, MAX_HITS);
}

export function GlobalSearch(): ReactElement {
  const { openTask, openArtifact } = useShell();
  const data = useOptionalWorkspaceData();
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  const hits = useMemo(
    () => searchWorkspace(query, data?.tasks ?? [], data?.artifacts ?? []),
    [query, data?.tasks, data?.artifacts],
  );

  // 外を押したら閉じる。閉じても入力は消さない（続きから打てる）。
  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent): void => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const pick = (hit: SearchHit): void => {
    if (hit.kind === 'task') openTask(hit.id);
    else openArtifact(hit.id);
    setOpen(false);
    setQuery('');
  };

  const listId = 'astra-search-results';
  return (
    <div className="astra-search" ref={root} role="search">
      <svg className="astra-search__icon" viewBox="0 0 16 16" aria-hidden="true">
        <circle cx="7" cy="7" r="4.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
        <path d="M10.5 10.5 14 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
      <input
        className="astra-search__input"
        type="search"
        value={query}
        placeholder="仕事・成果物を検索"
        aria-label="仕事・成果物を検索"
        aria-expanded={open && query.trim().length > 0}
        aria-controls={listId}
        onFocus={() => setOpen(true)}
        onChange={(event) => {
          setQuery(event.target.value);
          setOpen(true);
        }}
        onKeyDown={(event) => {
          if (event.key === 'Escape') setOpen(false);
          if (event.key === 'Enter' && hits[0]) pick(hits[0]);
        }}
      />
      {open && query.trim().length > 0 && (
        <ul className="astra-search__results" id={listId} role="listbox" aria-label="検索結果">
          {hits.length === 0 ? (
            <li className="astra-search__empty">「{query.trim()}」に合うものはありません</li>
          ) : (
            hits.map((hit) => (
              <li key={`${hit.kind}:${hit.id}`} role="option" aria-selected="false">
                <button
                  type="button"
                  className="astra-search__hit"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => pick(hit)}
                >
                  <span className="astra-search__hit-kind" aria-hidden="true">
                    {hit.kind === 'task' ? '●' : '▤'}
                  </span>
                  <span className="astra-search__hit-title">{hit.title}</span>
                  <span className="astra-search__hit-meta">{hit.meta}</span>
                </button>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}
