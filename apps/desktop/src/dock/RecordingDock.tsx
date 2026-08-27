/**
 * 録音中の Dock。画面下中央の capsule。
 *
 *   ● 03:42   CC   ⏸   ■
 *
 * 録音の正は main window。ここは写しを見せ、■ / ⏸ を命令として返すだけ。
 * CC で直近の文字起こしを capsule の上に足す（常時は出さない。邪魔になる）。
 */
import { useState, type ReactElement } from 'react';
import { formatElapsed, type MeetingSnapshot } from '../meeting/meetingBridge.js';

export function RecordingDock({
  meeting,
  onStop,
  onPause,
}: {
  meeting: MeetingSnapshot;
  onStop(): void;
  onPause(): void;
}): ReactElement {
  const [transcript, setTranscript] = useState(false);
  const paused = meeting.state === 'paused';
  return (
    <div className="astra-recording" data-transcript={transcript ? 'true' : 'false'}>
      {transcript && (
        <section className="astra-recording__transcript" aria-label="文字起こし">
          <header>
            <span>文字起こし</span>
            <span className="astra-recording__title">{meeting.title}</span>
          </header>
          {meeting.lines.length === 0 ? (
            <p className="astra-recording__empty">まだ発話がありません。</p>
          ) : (
            <ul>
              {meeting.lines.map((line) => (
                <li key={line.id} data-interim={line.interim ? 'true' : 'false'}>
                  {line.speakerTag !== null && (
                    <span className="astra-recording__speaker">話者 {line.speakerTag}</span>
                  )}
                  <span>{line.text}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
      <div className="astra-recording__bar" role="toolbar" aria-label="録音">
        <span className="astra-recording__timer">
          <span className="astra-recording__dot" data-state={meeting.state} aria-hidden="true" />
          <time>{formatElapsed(meeting.elapsedMs)}</time>
        </span>
        <button
          type="button"
          className="astra-recording__button"
          aria-pressed={transcript}
          aria-label={transcript ? '文字起こしを閉じる' : '文字起こしを見る'}
          onClick={() => setTranscript((v) => !v)}
        >
          CC
        </button>
        <button
          type="button"
          className="astra-recording__button"
          aria-label={paused ? '録音を再開' : '録音を一時停止'}
          onClick={onPause}
        >
          {paused ? '▶' : '⏸'}
        </button>
        <span className="astra-recording__divider" aria-hidden="true" />
        <button
          type="button"
          className="astra-recording__stop"
          aria-label="録音を止める"
          onClick={onStop}
        >
          <span aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}

/** 停止直後。保存できたことを一言。 */
export function ProcessingDock(): ReactElement {
  return (
    <div className="astra-processing" role="status">
      <span aria-hidden="true">✓</span>
      <span>会議を保存しました</span>
    </div>
  );
}
