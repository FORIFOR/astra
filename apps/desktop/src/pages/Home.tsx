/**
 * Home。UI/UX §8。
 *
 * KPI dashboard ではなく「今必要な仕事への入口」。
 * Attention は最大 3 件、Active work も短く、あとは Recent。
 * 業務 KPI は Home に常設しない（Domain dashboard は Work の専用 view へ）。
 */
import { useMemo, type ReactElement } from 'react';
import type { TaskView } from '@astra/api-client';
import type { Artifact } from '@astra/contracts';
import {
  buildAttentionFeed,
  feedFromBrief,
  greeting,
  type AttentionItem,
} from '../home/attention.js';
import type { DailyBrief } from '@astra/contracts';
import '../work/work.css';
import '../home/home.css';

const SEVERITY_LABEL: Record<AttentionItem['severity'], string> = {
  info: 'お知らせ',
  attention: '注意',
  'action-required': '要対応',
  critical: '重要',
};

export function HomePage({
  tasks = [],
  artifacts = [],
  displayName = null,
  now = Date.now(),
  brief = null,
  onOpenTask,
  onOpenArtifact,
  onShowAll,
}: {
  tasks?: readonly TaskView[];
  artifacts?: readonly Artifact[];
  displayName?: string | null;
  now?: number;
  /**
   * server が組んだ「今日気にすべきこと」。
   * 無ければ task だけから組む（server が古い / 落ちているとき）。
   */
  brief?: DailyBrief | null;
  onOpenTask?(taskId: string): void;
  onOpenArtifact?(artifactId: string): void;
  onShowAll?(): void;
}): ReactElement {
  const feed = useMemo(
    () => (brief ? feedFromBrief(brief) : buildAttentionFeed(tasks, now)),
    [brief, tasks, now],
  );
  const active = useMemo(
    () => tasks.filter((t) => t.status === 'RUNNING' || t.status === 'PENDING').slice(0, 3),
    [tasks],
  );
  const recent = artifacts.slice(0, 5);
  const empty = feed.items.length === 0 && active.length === 0 && recent.length === 0;

  return (
    <section className="astra-home" aria-label="ホーム">
      <h2 className="astra-home__greeting">
        {greeting(new Date(now).getHours())}
        {displayName ? `、${displayName}さん` : ''}
      </h2>

      {empty ? (
        // §8.1: 空状態では機能説明ではなく、1 つ頼んでもらう
        <p className="astra-home__invite">今、面倒なことを1つ頼んでください。</p>
      ) : (
        <>
          {feed.items.length > 0 && (
            <section aria-labelledby="astra-attention-title">
              <h3 id="astra-attention-title" className="astra-home__section">
                今日
              </h3>
              <ul className="astra-home__list">
                {feed.items.map((item) => (
                  <li key={item.id}>
                    <button
                      type="button"
                      className="astra-attention"
                      data-severity={item.severity}
                      onClick={() => onOpenTask?.(item.taskId)}
                    >
                      {/* §19: 状態を色だけで表さない */}
                      <span className="astra-attention__severity">
                        {SEVERITY_LABEL[item.severity]}
                      </span>
                      <span className="astra-attention__title">{item.title}</span>
                      {item.detail && (
                        <span className="astra-attention__detail">{item.detail}</span>
                      )}
                      <span className="astra-attention__action">{item.actionLabel}</span>
                    </button>
                  </li>
                ))}
              </ul>
              {feed.overflow > 0 && (
                <button type="button" className="astra-home__more" onClick={onShowAll}>
                  すべて見る（他 {feed.overflow} 件）
                </button>
              )}
            </section>
          )}

          {active.length > 0 && (
            <section aria-labelledby="astra-active-title">
              <h3 id="astra-active-title" className="astra-home__section">
                進行中
              </h3>
              <ul className="astra-home__list">
                {active.map((task) => (
                  <li key={task.id}>
                    <button
                      type="button"
                      className="astra-work-row"
                      onClick={() => onOpenTask?.(task.id)}
                    >
                      <span aria-hidden="true">●</span>
                      <span>{task.title ?? '名前のない仕事'}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {recent.length > 0 && (
            <section aria-labelledby="astra-recent-title">
              <h3 id="astra-recent-title" className="astra-home__section">
                最近の成果物
              </h3>
              <ul className="astra-home__list">
                {recent.map((artifact) => (
                  <li key={artifact.id}>
                    <button
                      type="button"
                      className="astra-work-row"
                      onClick={() => onOpenArtifact?.(artifact.id)}
                    >
                      <span>{artifact.title}</span>
                      <span className="astra-work-row__meta">{artifact.type}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </section>
  );
}
