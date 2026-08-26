/**
 * Work detail。UI/UX §9.2。
 *
 * | Tab      | 内容                                            |
 * | Overview | goal / current state / next step / Context chips |
 * | Progress | semantic task steps / timestamps                |
 * | Outputs  | Artifacts / receipts / related meetings         |
 * | Evidence | Research / sources / contradictions             |
 * | Activity | tool/audit event を人間可読に要約                |
 *
 * **無い tab を出さない**のではなく、**中身が無いことを言う。**
 * tab ごと消すと「この仕事には根拠が無い」のか
 * 「まだ実装していない」のか、利用者には区別が付かない。
 */
import { useEffect, useMemo, useState, type ReactElement } from 'react';
import type { Artifact, ContextSource } from '@astra/contracts';
import type { AstraClient } from '@astra/api-client';
import { Receipts } from './Receipts.js';
import { TaskEvidence } from './EvidenceLedger.js';
import { formatElapsed, type WorkStep, type WorkView } from './workView.js';

export const WORK_DETAIL_TABS = [
  { id: 'overview', label: '概要' },
  { id: 'progress', label: '経過' },
  { id: 'outputs', label: '成果' },
  { id: 'evidence', label: '根拠' },
  { id: 'activity', label: '記録' },
] as const;

export type WorkDetailTab = (typeof WORK_DETAIL_TABS)[number]['id'];

const STATE_LABEL: Record<WorkView['status'], string> = {
  PENDING: 'これから始まります',
  RUNNING: '進めています',
  WAITING_APPROVAL: '確認を待っています',
  CANCELLING: '止めています',
  COMPLETED: '終わりました',
  FAILED: '完了できませんでした',
  CANCELLED: '中止しました',
  UNKNOWN: '状態が分かりません',
};

function at(iso: string | null): string | null {
  if (iso === null) return null;
  return new Date(iso).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });
}

/** §9.2 Overview の next step。**次が無いときに、あるふりをしない。** */
export function nextStep(view: WorkView): string | null {
  if (view.status === 'WAITING_APPROVAL') return view.attention?.summary ?? '確認を待っています';
  const running = view.steps.find((s) => s.state === 'active' || s.state === 'retrying');
  if (running) return running.label || null;
  const todo = view.steps.find((s) => s.state === 'todo');
  return todo?.label || null;
}

function Overview({
  view,
  sources,
}: {
  view: WorkView;
  sources: readonly ContextSource[];
}): ReactElement {
  const next = nextStep(view);
  return (
    <div className="astra-detail__overview">
      <dl>
        <dt>頼んだこと</dt>
        <dd>{view.title ?? '（名前がありません）'}</dd>
        <dt>いまの状態</dt>
        <dd>{STATE_LABEL[view.status]}</dd>
        <dt>次にすること</dt>
        {/* 次が無いなら無いと言う */}
        <dd>{next ?? '次にすることはありません'}</dd>
      </dl>
      <section aria-label="この仕事で使った情報">
        <h4>使った情報</h4>
        {sources.length === 0 ? (
          <p className="astra-empty">記録が残っていません。</p>
        ) : (
          <ul className="astra-detail__chips">
            {sources.map((source) => (
              <li key={source.id}>{source.label}</li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function StepRow({ step }: { step: WorkStep }): ReactElement {
  const started = at(step.startedAt);
  const ended = at(step.endedAt);
  return (
    <li className="astra-detail__step" data-state={step.state}>
      <span className="astra-detail__step-label">{step.label || '準備しています'}</span>
      {step.detail && <span className="astra-detail__step-detail">{step.detail}</span>}
      {/* §9.2: timestamps。分からないものは出さない。 */}
      <span className="astra-detail__step-time">
        {started === null ? '' : ended === null ? `${started} 〜` : `${started} 〜 ${ended}`}
      </span>
    </li>
  );
}

function Progress({ view }: { view: WorkView }): ReactElement {
  if (view.steps.length === 0) {
    return <p className="astra-empty">まだ何も始まっていません。</p>;
  }
  const elapsed = formatElapsed(view.elapsedMs);
  return (
    <div>
      <ol className="astra-detail__steps">
        {view.steps.map((step) => (
          <StepRow key={step.index} step={step} />
        ))}
      </ol>
      {elapsed && <p className="astra-detail__elapsed">{elapsed}経過</p>}
    </div>
  );
}

function Outputs({
  client,
  taskId,
  artifacts,
  onOpenArtifact,
}: {
  client: AstraClient | null;
  taskId: string;
  artifacts: readonly Artifact[] | null;
  onOpenArtifact?(artifactId: string): void;
}): ReactElement {
  return (
    <div className="astra-detail__outputs">
      <section aria-label="できたもの">
        <h4>できたもの</h4>
        {artifacts === null ? (
          <p className="astra-empty">読み込んでいます。</p>
        ) : artifacts.length === 0 ? (
          <p className="astra-empty">まだ成果物はありません。</p>
        ) : (
          <ul>
            {artifacts.map((artifact) => (
              <li key={artifact.id}>
                <button type="button" onClick={() => onOpenArtifact?.(artifact.id)}>
                  {artifact.title}
                </button>
                {/* 会議から生まれたものは、そう分かるようにする（§9.2 related meetings） */}
                {artifact.type === 'MEETING_BUNDLE' && <span>会議の記録</span>}
              </li>
            ))}
          </ul>
        )}
      </section>
      <section aria-label="実行した操作">
        <h4>実行した操作</h4>
        <Receipts client={client} taskId={taskId} />
      </section>
    </div>
  );
}

/** §9.2 Activity: tool/audit event を**人間可読に要約**する。tool 名は出さない。 */
export function activityLines(view: WorkView): { at: string | null; text: string }[] {
  const lines: { at: string | null; text: string }[] = [];
  if (view.startedAt) lines.push({ at: view.startedAt, text: '始めました' });
  for (const step of view.steps) {
    if (step.startedAt) {
      lines.push({ at: step.startedAt, text: step.label || '準備しています' });
    }
  }
  if (view.status === 'WAITING_APPROVAL' && view.attention) {
    lines.push({ at: null, text: `確認をお願いしました: ${view.attention.summary}` });
  }
  if (view.endedAt) {
    lines.push({
      at: view.endedAt,
      text:
        view.status === 'FAILED'
          ? '完了できませんでした'
          : view.status === 'CANCELLED'
            ? '中止しました'
            : '終わりました',
    });
  }
  return lines;
}

function Activity({ view }: { view: WorkView }): ReactElement {
  const lines = activityLines(view);
  if (lines.length === 0) return <p className="astra-empty">まだ記録がありません。</p>;
  return (
    <ol className="astra-detail__activity">
      {lines.map((line, index) => (
        <li key={`${line.at ?? 'x'}-${index}`}>
          <span className="astra-detail__step-time">{at(line.at) ?? ''}</span>
          <span>{line.text}</span>
        </li>
      ))}
    </ol>
  );
}

export function WorkDetail({
  view,
  taskId,
  client = null,
  sources = [],
  onOpenArtifact,
}: {
  view: WorkView;
  taskId: string;
  client?: AstraClient | null;
  /** この仕事で使った情報。記録が無ければ空（推測で埋めない）。 */
  sources?: readonly ContextSource[];
  onOpenArtifact?(artifactId: string): void;
}): ReactElement {
  const [tab, setTab] = useState<WorkDetailTab>('overview');
  const [artifacts, setArtifacts] = useState<readonly Artifact[] | null>(null);

  useEffect(() => {
    if (!client) {
      setArtifacts(null);
      return;
    }
    let cancelled = false;
    setArtifacts(null);
    void client
      .listArtifacts({ sourceTaskId: taskId })
      .then((page) => {
        if (!cancelled) setArtifacts(page.items);
      })
      .catch(() => {
        // 取れなかったことを空と取り違えないよう、null のままにする
        if (!cancelled) setArtifacts(null);
      });
    return () => {
      cancelled = true;
    };
  }, [client, taskId]);

  const body = useMemo(() => {
    switch (tab) {
      case 'overview':
        return <Overview view={view} sources={sources} />;
      case 'progress':
        return <Progress view={view} />;
      case 'outputs':
        return (
          <Outputs
            client={client}
            taskId={taskId}
            artifacts={artifacts}
            {...(onOpenArtifact ? { onOpenArtifact } : {})}
          />
        );
      case 'evidence':
        // §15: L0 から 1 段ずつ掘る。最初から全部は出さない。
        return <TaskEvidence client={client} taskId={taskId} />;
      case 'activity':
        return <Activity view={view} />;
    }
  }, [tab, view, sources, client, taskId, artifacts, onOpenArtifact]);

  return (
    <section className="astra-detail" aria-label="仕事の詳細">
      <div className="astra-detail__tabs" role="tablist" aria-label="詳細の切り替え">
        {WORK_DETAIL_TABS.map((option) => (
          <button
            key={option.id}
            type="button"
            role="tab"
            id={`work-tab-${option.id}`}
            aria-selected={tab === option.id}
            aria-controls={`work-panel-${option.id}`}
            onClick={() => setTab(option.id)}
          >
            {option.label}
          </button>
        ))}
      </div>
      <div
        className="astra-detail__panel"
        role="tabpanel"
        id={`work-panel-${tab}`}
        aria-labelledby={`work-tab-${tab}`}
      >
        {body}
      </div>
    </section>
  );
}
