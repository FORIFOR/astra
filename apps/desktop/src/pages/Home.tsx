/**
 * Home。UI/UX §8。
 *
 * KPI dashboard ではなく「今必要な仕事への入口」。
 * Attention は最大 3 件、Active work も短く、あとは Recent。
 * 業務 KPI は Home に常設しない（Domain dashboard は Work の専用 view へ）。
 */
import { useMemo, useState, type ReactElement } from 'react';
import type { TaskView } from '@astra/api-client';
import type { Artifact } from '@astra/contracts';
import { typeLabel } from './Library.js';
import { relativeTime } from '../home/time.js';
import { kindLabel } from '../work/kind.js';
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
  onDismiss,
  onAsk,
  notice = null,
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
  /**
   * 「あとで」と「今後は出さない」。UI/UX §16。
   * **覚えない dismiss は、拒否ではなく無視。**押した先で覚える。
   */
  onDismiss?(itemId: string, verdict: 'later' | 'never'): void;
  /**
   * §8 の 1 行目「何を終わらせますか？」。Home は「今必要なこと + universal entry」。
   * **入口が無い Home は、ただの一覧。**
   */
  onAsk?(text: string): void;
  /** 頼んだ結果の一言（聞き返し・送れなかった理由）。無ければ出さない。 */
  notice?: string | null;
}): ReactElement {
  const [ask, setAsk] = useState('');
  // 押した直後に消す。返事を待って残っていると、押していないように見える。
  const [hidden, setHidden] = useState<ReadonlySet<string>>(new Set());
  const built = useMemo(
    () => (brief ? feedFromBrief(brief) : buildAttentionFeed(tasks, now)),
    [brief, tasks, now],
  );
  const feed = useMemo(
    () => ({ ...built, items: built.items.filter((item) => !hidden.has(item.id)) }),
    [built, hidden],
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

      {/* §8: universal entry。Dock と同じ口で、Home からも頼める */}
      <form
        className="astra-home__ask"
        onSubmit={(event) => {
          event.preventDefault();
          const text = ask.trim();
          if (text.length === 0) return;
          onAsk?.(text);
          setAsk('');
        }}
      >
        <input
          className="astra-home__ask-input"
          value={ask}
          placeholder="何を終わらせますか？"
          aria-label="何を終わらせますか"
          onChange={(event) => setAsk(event.target.value)}
        />
        <button type="submit" className="astra-home__ask-send" disabled={ask.trim().length === 0}>
          頼む
        </button>
      </form>
      {notice && (
        <p className="astra-home__notice" role="status">
          {notice}
        </p>
      )}

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
                    {onDismiss && (
                      <span className="astra-attention__feedback">
                        <button
                          type="button"
                          onClick={() => {
                            setHidden((current) => new Set(current).add(item.id));
                            onDismiss(item.id, 'later');
                          }}
                        >
                          あとで
                        </button>
                        {/* §16: 明示拒否。長期尊重されることを、文言でも言う。 */}
                        <button
                          type="button"
                          onClick={() => {
                            setHidden((current) => new Set(current).add(item.id));
                            onDismiss(item.id, 'never');
                          }}
                        >
                          今後は出さない
                        </button>
                      </span>
                    )}
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
                      <span className="astra-work-row__time">
                        {relativeTime(task.updated_at, now)}
                      </span>
                      <span className="astra-work-row__body">
                        <span className="astra-work-row__title">
                          {task.title ?? '名前のない仕事'}
                        </span>
                        <span className="astra-work-row__detail">{kindLabel(task.kind)}</span>
                      </span>
                      {/* §8 の「12 sources  進行中」。状態を人の言葉で添える */}
                      <span className="astra-work-row__meta" data-live="true">
                        {task.status === 'WAITING_APPROVAL'
                          ? '確認待ち'
                          : task.status === 'PAUSED_HOST_OFFLINE'
                            ? '端末の復帰待ち'
                            : '進行中'}
                      </span>
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
                      <span className="astra-work-row__time">
                        {relativeTime(artifact.created_at, now)}
                      </span>
                      <span className="astra-work-row__body">
                        <span className="astra-work-row__title">{artifact.title}</span>
                      </span>
                      {/* Library と同じ表で。Home だけ `DOCUMENT` のまま出ていた */}
                      <span className="astra-work-row__meta">{typeLabel(artifact.type)}</span>
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
