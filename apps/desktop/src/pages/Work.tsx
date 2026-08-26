/**
 * Work タブ。UI/UX §9。
 *
 * 「AI エージェント」ではなく**仕事の単位**で管理する。
 * 裏の Agent は詳細/管理者向けにだけ開示する。
 */
import { useMemo, useState, type ReactElement } from 'react';
import type { TaskView } from '@astra/api-client';
import type { TaskStatus } from '@astra/contracts';
import { WorkCard } from '../work/WorkCard.js';
import { useTaskStream } from '../work/useTaskStream.js';
import type { AstraClient } from '@astra/api-client';
import '../work/work.css';

export const WORK_FILTERS = [
  { id: 'active', label: '進行中' },
  { id: 'waiting', label: '確認待ち' },
  { id: 'done', label: '完了' },
  { id: 'failed', label: '失敗' },
  { id: 'all', label: 'すべて' },
] as const;

export type WorkFilter = (typeof WORK_FILTERS)[number]['id'];

/** §9 の Filter 定義。ここ以外で status を並べない。 */
export function matchesFilter(status: TaskStatus, filter: WorkFilter): boolean {
  switch (filter) {
    case 'active':
      return status === 'PENDING' || status === 'RUNNING' || status === 'CANCELLING';
    case 'waiting':
      return status === 'WAITING_APPROVAL';
    case 'done':
      return status === 'COMPLETED';
    case 'failed':
      return status === 'FAILED' || status === 'CANCELLED';
    case 'all':
      return true;
  }
}

export function WorkPage({
  client = null,
  tasks = [],
}: {
  client?: AstraClient | null;
  tasks?: readonly TaskView[];
}): ReactElement {
  const [filter, setFilter] = useState<WorkFilter>('active');
  const [openTaskId, setOpenTaskId] = useState<string | null>(null);
  const { view, reconnecting } = useTaskStream(client, openTaskId);

  const visible = useMemo(
    () => tasks.filter((task) => matchesFilter(task.status, filter)),
    [tasks, filter],
  );

  return (
    <section className="astra-work-list" aria-label="ワーク">
      <div className="astra-work-filters" role="group" aria-label="絞り込み">
        {WORK_FILTERS.map((option) => (
          <button
            key={option.id}
            type="button"
            aria-pressed={filter === option.id}
            onClick={() => setFilter(option.id)}
          >
            {option.label}
          </button>
        ))}
      </div>

      {visible.length === 0 ? (
        <p className="astra-empty">
          {filter === 'active' ? '進行中の仕事はありません。' : '該当する仕事はありません。'}
        </p>
      ) : (
        <ul className="astra-work-list__rows">
          {visible.map((task) => (
            <li key={task.id}>
              <button
                type="button"
                className="astra-work-row"
                onClick={() => setOpenTaskId(task.id)}
              >
                <span aria-hidden="true">{task.status === 'WAITING_APPROVAL' ? '!' : '●'}</span>
                <span>{task.title ?? '名前のない仕事'}</span>
                <span className="astra-work-row__meta">{task.status}</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {openTaskId && (
        <>
          {/* §21: 接続が切れてもローカルの作業は続いていることを伝える */}
          {reconnecting && (
            <p className="astra-empty" role="status">
              接続が切れました。再接続しています。処理は続いています。
            </p>
          )}
          <WorkCard view={view} onOpen={() => undefined} />
        </>
      )}
    </section>
  );
}
