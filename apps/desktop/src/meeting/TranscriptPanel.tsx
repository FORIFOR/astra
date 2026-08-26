/**
 * transcript。UI/UX §12.4。
 *
 * 既定では閉じている（§12.3 Notes first）。開いたときだけ描く。
 * interim は淡色、確定で通常色。話者は名前が付いていればその名前。
 */
import type { ReactElement } from 'react';
import { speakerLabel, type TranscriptLine } from './meetingView.js';

export function TranscriptPanel({
  lines,
  names,
  onNameSpeaker,
}: {
  lines: readonly TranscriptLine[];
  names: ReadonlyMap<number, string>;
  onNameSpeaker?(speakerTag: number): void;
}): ReactElement {
  if (lines.length === 0) {
    return (
      <div className="astra-transcript" aria-label="Transcript">
        <p className="astra-transcript__empty">まだ発言がありません。</p>
      </div>
    );
  }

  return (
    <ol className="astra-transcript" aria-label="Transcript">
      {lines.map((line) => (
        <li
          key={line.id}
          className="astra-transcript__line"
          data-interim={line.interim ? 'true' : 'false'}
        >
          <span className="astra-transcript__at">{timeLabel(line.startMs)}</span>
          {onNameSpeaker && line.speakerTag !== null ? (
            <button
              type="button"
              className="astra-transcript__who"
              onClick={() => onNameSpeaker(line.speakerTag!)}
            >
              {speakerLabel(line.speakerTag, names)}
            </button>
          ) : (
            <span className="astra-transcript__who">{speakerLabel(line.speakerTag, names)}</span>
          )}
          <span className="astra-transcript__text">{line.text}</span>
          {line.translation ? (
            <span className="astra-transcript__translation">{line.translation}</span>
          ) : null}
        </li>
      ))}
    </ol>
  );
}

function timeLabel(ms: number): string {
  const total = Math.floor(ms / 1000);
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}
