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
      {state === 'degraded' ? (
        <span className="astra-rec__degraded">
          文字起こしの精度が低下しています。録音は継続中。
        </span>
      ) : null}
      <button type="button" onClick={onPause}>
        {state === 'paused' ? '再開' : '一時停止'}
      </button>
      <button type="button" onClick={onStop}>
        終了
      </button>
    </div>
  );
}
