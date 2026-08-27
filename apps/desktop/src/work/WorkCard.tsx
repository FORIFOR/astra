/**
 * Work Surface / Task Card。UI/UX §6。
 *
 * 進捗・承認・結果を同じ card 面で見せる。Agent orchestration は隠す。
 */
import type { ReactElement } from 'react';
import { formatElapsed, type StepState, type WorkView } from './workView.js';

const STEP_MARK: Record<StepState, string> = {
  done: '✓',
  active: '●',
  retrying: '↻',
  failed: '×',
  todo: '○',
};

const STEP_LABEL: Record<StepState, string> = {
  done: '完了',
  active: '進行中',
  // §6.2: retry 中は失敗として固定しない
  retrying: '再試行中',
  failed: '失敗',
  todo: '未着手',
};

function Steps({ steps }: { steps: WorkView['steps'] }): ReactElement | null {
  if (steps.length === 0) return null;
  return (
    <ol className="astra-work__steps">
      {steps.map((step) => (
        <li key={step.index} className="astra-work__step" data-state={step.state}>
          <span className="astra-work__mark" aria-hidden="true">
            {STEP_MARK[step.state]}
          </span>
          {/* §19: 状態を色だけで表さない */}
          <span className="astra-visually-hidden">{STEP_LABEL[step.state]}</span>
          <span className="astra-work__label">{step.label || '準備しています'}</span>
          {step.detail && <span className="astra-work__detail">{step.detail}</span>}
        </li>
      ))}
    </ol>
  );
}

export function WorkCard({
  view,
  onApprove,
  onReject,
  onOpen,
  onStop,
}: {
  view: WorkView;
  onApprove?(approvalId: string): void;
  onReject?(approvalId: string): void;
  onOpen?(): void;
  onStop?(): void;
}): ReactElement {
  const elapsed = formatElapsed(view.elapsedMs);
  const running = view.status === 'RUNNING' || view.status === 'PENDING';

  return (
    <section className="astra-work" data-status={view.status} aria-label="仕事の進行">
      <header className="astra-work__head">
        <h2 className="astra-work__title">{view.title ?? '準備しています'}</h2>
        <span className="astra-work__status">
          {view.status === 'WAITING_APPROVAL' ? '確認待ち' : statusLabel(view.status)}
        </span>
      </header>

      {/* §6.2: 進捗率は真の進行率を計算できるときだけ */}
      {view.percent !== null && (
        <div
          className="astra-work__bar"
          role="progressbar"
          aria-valuenow={view.percent}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <span style={{ width: `${view.percent}%` }} />
        </div>
      )}

      <Steps steps={view.steps} />

      {elapsed && <p className="astra-work__elapsed">{elapsed}経過</p>}

      {/* §6.2: 承認待ちは進捗と混ぜず、別の attention state にする */}
      {view.attention && (
        <div className="astra-work__attention" role="group" aria-label="確認が必要です">
          <p className="astra-work__consequence">{view.attention.summary}</p>
          <div className="astra-work__actions">
            <button type="button" onClick={() => onReject?.(view.attention!.approvalId)}>
              やめる
            </button>
            <button
              type="button"
              className="astra-work__primary"
              onClick={() => onApprove?.(view.attention!.approvalId)}
            >
              {/* §14.1: 「承認」ではなく結果を書く */}
              {view.attention.primaryActionLabel}
            </button>
          </div>
        </div>
      )}

      {/* §4.4: 端末待ちは失敗ではない。別の面で、待てば戻ることを言う。 */}
      {view.pausedReason && (
        <p className="astra-work__paused" role="status">
          {view.pausedReason}
        </p>
      )}

      {view.error && (
        <p className="astra-work__error" role="alert">
          {/* §21: 仕事への影響と次の選択肢を書く。抽象的な失敗表現にしない。 */}
          完了できませんでした。途中までの結果は保存されています。
          {/* §24: 何を試して、何が使えなかったか。**無ければ出さない。** */}
          {view.error.explanation && (
            <span className="astra-work__attempts">{view.error.explanation}</span>
          )}
          <span className="astra-work__recovery">{recoveryLabel(view.error.recovery)}</span>
        </p>
      )}

      <div className="astra-work__footer">
        {running && onStop && (
          // §4.4: Dismiss と Cancel を分ける。停止は明示的な操作から。
          <button type="button" onClick={onStop}>
            停止する
          </button>
        )}
        {onOpen && (
          <button type="button" onClick={onOpen}>
            詳しく見る
          </button>
        )}
      </div>
    </section>
  );
}

/**
 * 状態を人の言葉にする。**生の enum を画面に出さない**（§6.1）。
 * 一覧（Work.tsx）と card の両方がこれを使う。別々に持つと、
 * 片方が `RUNNING` のまま残る（実際そうなっていた）。
 */
export function statusLabel(status: WorkView['status']): string {
  switch (status) {
    case 'PAUSED_HOST_OFFLINE':
      // 失敗として見せない。待てば戻る（§4.4）。
      return '端末の復帰待ち';
    case 'COMPLETED':
      return '完了';
    case 'FAILED':
      return '失敗';
    case 'CANCELLED':
      return '中止';
    case 'CANCELLING':
      return '停止しています';
    case 'UNKNOWN':
      return '';
    default:
      return '進行中';
  }
}

function recoveryLabel(recovery: string): string {
  switch (recovery) {
    case 'retry':
      return 'もう一度試せます。';
    case 'reconnect':
      return '接続を確認してください。';
    case 'grant_permission':
      return '権限が必要です。';
    case 'reauthenticate':
      return 'サインインし直してください。';
    case 'handoff':
      return '手動での対応が必要です。';
    default:
      return '';
  }
}
