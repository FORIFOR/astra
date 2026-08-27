/**
 * Inspector の中身。UI/UX §7.1（Context / Evidence / Activity）。
 *
 * Inspector は**開けるようになったが、中身が無かった。**
 * 空の panel に「詳細」とだけ出ているのは、無いより分かりにくい。
 *
 * ここに置くのは、開いている仕事の**周辺**。本文は Main にある。
 *   Context  … 何についての仕事か
 *   Evidence … 何に基づいているか（根拠の台帳）
 *   Activity … 何をしたか（実行の記録）
 */
import { useState, type ReactElement } from 'react';
import type { AstraClient, TaskView } from '@astra/api-client';
import { TaskEvidence } from '../work/EvidenceLedger.js';
import { Receipts } from '../work/Receipts.js';

export const INSPECTOR_TABS = [
  { id: 'context', label: '文脈' },
  { id: 'evidence', label: '根拠' },
  { id: 'activity', label: '記録' },
] as const;

export type InspectorTab = (typeof INSPECTOR_TABS)[number]['id'];

export function TaskInspector({
  client,
  task,
}: {
  client: AstraClient | null;
  task: TaskView | null;
}): ReactElement {
  const [tab, setTab] = useState<InspectorTab>('context');

  if (!task) {
    // 何も開いていないなら、そう言う。空の tab を並べない。
    return <p className="astra-empty">仕事を開くと、ここに文脈と根拠が出ます。</p>;
  }

  return (
    <div className="astra-inspector__tabs">
      <div role="tablist" aria-label="仕事の周辺" className="astra-inspector__tablist">
        {INSPECTOR_TABS.map((option) => (
          <button
            key={option.id}
            type="button"
            role="tab"
            aria-selected={tab === option.id}
            onClick={() => setTab(option.id)}
          >
            {option.label}
          </button>
        ))}
      </div>

      {tab === 'context' && (
        <dl className="astra-inspector__facts">
          <dt>仕事</dt>
          <dd>{task.title ?? '名前のない仕事'}</dd>
          <dt>頼んだこと</dt>
          {/* 入力の中身は生のまま出さない。message があればそれだけ */}
          <dd>{typeof task.input['message'] === 'string' ? task.input['message'] : '—'}</dd>
          <dt>始まり</dt>
          <dd>
            {task.started_at
              ? new Date(task.started_at).toLocaleString('ja-JP')
              : 'まだ始まっていません'}
          </dd>
        </dl>
      )}
      {tab === 'evidence' && <TaskEvidence client={client} taskId={task.id} />}
      {tab === 'activity' && <Receipts client={client} taskId={task.id} />}
    </div>
  );
}
