/**
 * 録音中の最小表示。UI/UX §12.2。
 *
 * **録音中か分からない状態を作らない。**装飾的な大波形を主役にせず、
 * 状態・経過時間・話者数だけを出す。読み上げにも "Recording" を出す（§18）。
 */
import type { ReactElement } from 'react';
import { elapsedLabel } from './meetingView.js';

export type RecordingState = 'recording' | 'paused' | 'degraded';

const LABEL: Record<RecordingState, string> = {
  recording: 'Recording',
  paused: 'Paused',
  // 文字起こしが落ちても**録音は続いている**ことを言う（UI/UX §16）
  degraded: 'Recording, transcription degraded',
};

export function RecordingIndicator({
  state,
  title,
  elapsedMs,
  speakers,
  onPause,
  onStop,
}: {
  state: RecordingState;
  title: string;
  elapsedMs: number;
  speakers: number;
  onPause(): void;
  onStop(): void;
}): ReactElement {
  return (
    <div
      className="astra-rec"
      data-state={state}
      role="status"
      aria-label={`${LABEL[state]} — ${title}`}
    >
      <span className="astra-rec__dot" aria-hidden="true" />
      <span className="astra-rec__state">{state === 'paused' ? '一時停止' : 'REC'}</span>
      <span className="astra-rec__time">{elapsedLabel(elapsedMs)}</span>
      <span className="astra-rec__title">{title}</span>
      <span className="astra-rec__speakers">{speakers} speakers</span>
      {/* §12.2: 音声レベルは細い meter だけ。装飾的な大波形を主役にしない */}
      <span className="astra-rec__meter" aria-hidden="true" />
      <button
        type="button"
        className="astra-rec__button"
        aria-label={state === 'paused' ? '再開' : '一時停止'}
        title={state === 'paused' ? '再開' : '一時停止'}
        onClick={onPause}
      >
        {state === 'paused' ? (
          <svg viewBox="0 0 16 16" aria-hidden="true">
            <path d="M5 3.5v9l7-4.5z" fill="currentColor" />
          </svg>
        ) : (
          <svg viewBox="0 0 16 16" aria-hidden="true">
            <rect x="4" y="3.5" width="3" height="9" rx="0.8" fill="currentColor" />
            <rect x="9" y="3.5" width="3" height="9" rx="0.8" fill="currentColor" />
          </svg>
        )}
      </button>
      <button
        type="button"
        className="astra-rec__button astra-rec__button--stop"
        aria-label="終了"
        title="終了"
        onClick={onStop}
      >
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <rect x="4" y="4" width="8" height="8" rx="1.5" fill="currentColor" />
        </svg>
      </button>
      {state === 'degraded' ? (
        <span className="astra-rec__degraded">
          文字起こしの精度が低下しています。録音は継続中。
        </span>
      ) : null}
    </div>
  );
}
