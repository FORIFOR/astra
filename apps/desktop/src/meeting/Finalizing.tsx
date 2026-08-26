/**
 * 終了後の処理中。UI/UX §12.5。
 *
 * **「閉じてよい」と明示する。**Task Runtime 側で続くので、
 * ここに人を引き止める理由が無い。引き止めると、閉じられない画面になる。
 */
import type { ReactElement } from 'react';

export interface FinalizeStep {
  readonly label: string;
  readonly state: 'done' | 'running' | 'waiting';
}

/** finalize の 5 段（Phase 3 実装仕様 §5）を、進捗から見せる形に落とす。 */
export function finalizeSteps(completedSteps: number): FinalizeStep[] {
  const labels = [
    '録音を保存',
    '高精度の文字起こし',
    '話者の突き合わせ',
    '要点・決定事項・ToDo',
    '議事録の保存',
  ];
  return labels.map((label, index) => ({
    label,
    state: index < completedSteps ? 'done' : index === completedSteps ? 'running' : 'waiting',
  }));
}

export function Finalizing({
  title,
  completedSteps,
  onOpenWork,
}: {
  title: string;
  completedSteps: number;
  onOpenWork?(): void;
}): ReactElement {
  return (
    <section className="astra-finalize" aria-label={`${title} の処理状況`}>
      <h2 className="astra-finalize__title">会議が終了しました</h2>
      <ol className="astra-finalize__steps">
        {finalizeSteps(completedSteps).map((step) => (
          <li key={step.label} data-state={step.state}>
            <span aria-hidden="true">
              {step.state === 'done' ? '✓' : step.state === 'running' ? '●' : '○'}
            </span>
            {step.label}
          </li>
        ))}
      </ol>
      <p className="astra-finalize__note">このウィンドウは閉じても構いません。処理は続きます。</p>
      {onOpenWork ? (
        <button type="button" onClick={onOpenWork}>
          Work で進捗を見る
        </button>
      ) : null}
    </section>
  );
}
