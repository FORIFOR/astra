/**
 * Work タブ。UI/UX §9。
 *
 * 「AI エージェント」ではなく**仕事の単位**で管理する。
 * 裏の Agent は詳細/管理者向けにだけ開示する。
 */
import { useEffect, useMemo, useState, type ReactElement } from 'react';
import type { TaskView } from '@astra/api-client';
import type { TaskStatus } from '@astra/contracts';
import { WorkCard, statusLabel } from '../work/WorkCard.js';
import { useTaskStream } from '../work/useTaskStream.js';
import { WorkDetail } from '../work/WorkDetail.js';
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
      return (
        status === 'PENDING' ||
        status === 'RUNNING' ||
        status === 'CANCELLING' ||
        // 止まっているが、進行中の仕事。失敗の側へ寄せない（§4.4）。
        status === 'PAUSED_HOST_OFFLINE'
      );
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
  initialTaskId = null,
  onStartMeeting,
  onOpenArtifact,
}: {
  client?: AstraClient | null;
  tasks?: readonly TaskView[];
  /** 他のタブから「この仕事を見せる」で渡ってくる（UI-3 の連続性）。 */
  initialTaskId?: string | null;
  /** 会議を始める。会議は 5 つ目のタブにしない（正本 §2）。 */
  onStartMeeting?: (() => void) | undefined;
  /** 成果物を Library で開く（§9.2 Outputs → §10.2 lineage）。 */
  onOpenArtifact?: ((artifactId: string) => void) | undefined;
}): ReactElement {
  const [filter, setFilter] = useState<WorkFilter>('active');
  const [openTaskId, setOpenTaskId] = useState<string | null>(initialTaskId);

  // 他タブから指定された仕事は、その状態に合う絞り込みへ切り替えて必ず見えるようにする
  useEffect(() => {
    if (!initialTaskId) return;
    setOpenTaskId(initialTaskId);
    const task = tasks.find((t) => t.id === initialTaskId);
    if (task && !matchesFilter(task.status, filter)) setFilter('all');
    // filter を依存に入れると、利用者が絞り込みを変えた直後に戻してしまう
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialTaskId, tasks]);
  const { view, reconnecting } = useTaskStream(client, openTaskId);

  const visible = useMemo(
    () => tasks.filter((task) => matchesFilter(task.status, filter)),
    [tasks, filter],
  );

  return (
    <section className="astra-work-list" aria-label="ワーク">
      <div className="astra-work-actions">
        {/* 会議はタブではなく仕事の一つ。ここから始める（UI/UX §12.1）。 */}
        <button type="button" onClick={onStartMeeting} disabled={!onStartMeeting}>
          会議を記録
        </button>
      </div>

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
                {/* §9.1: 状態は人の言葉で。`RUNNING` をそのまま出していた。 */}
                <span className="astra-work-row__meta">
                  {task.status === 'WAITING_APPROVAL' ? '確認待ち' : statusLabel(task.status)}
                  {task.started_at && ` · ${startedLabel(task.started_at)}`}
                </span>
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
          {/* §9.2: Overview / Progress / Outputs / Evidence / Activity */}
          <WorkDetail
            view={view}
            taskId={openTaskId}
            client={client}
            {...(onOpenArtifact ? { onOpenArtifact } : {})}
          />
        </>
      )}
    </section>
  );
}

/** §9.1 の「Started 14:02」。日付は今日なら出さない。 */
function startedLabel(iso: string): string {
  const at = new Date(iso);
  const time = at.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });
  return at.toDateString() === new Date().toDateString()
    ? `${time} 開始`
    : `${at.toLocaleDateString('ja-JP', { month: 'numeric', day: 'numeric' })} ${time} 開始`;
}
