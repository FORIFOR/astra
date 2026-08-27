/**
 * 会議中の画面。UI/UX §12.3。
 *
 * **Notes が主役。**AI が勝手に書き換えない。transcript は既定で閉じ、
 * 求められたときだけ右に開く。巨大な録音画面を常駐させない。
 */
import { useMemo, useState, type ReactElement } from 'react';
import { RecordingIndicator, type RecordingState } from './RecordingIndicator.js';
import { TranscriptPanel } from './TranscriptPanel.js';
import { LiveAnnouncer } from './LiveAnnouncer.js';
import { speakersSoFar, type MeetingView } from './meetingView.js';

export type MarkerKind = 'important' | 'decision' | 'todo';

const MARKERS: { id: MarkerKind; label: string }[] = [
  { id: 'important', label: '重要' },
  { id: 'decision', label: '決定' },
  { id: 'todo', label: 'ToDo' },
];

export function MeetingSurface({
  title,
  view,
  elapsedMs,
  state,
  notes,
  speakerNames,
  onNotesChange,
  onMark,
  onNameSpeaker,
  onPause,
  onStop,
  announceTranscript = false,
}: {
  title: string;
  view: MeetingView;
  elapsedMs: number;
  state: RecordingState;
  notes: string;
  speakerNames: ReadonlyMap<number, string>;
  onNotesChange(value: string): void;
  onMark(kind: MarkerKind): void;
  onNameSpeaker(speakerTag: number): void;
  onPause(): void;
  onStop(): void;
  /**
   * 確定した発言を読み上げへ渡すか。UI/UX §19。
   * 既定は off（「通知**可能**にする」であって、常に通知するではない）。
   */
  announceTranscript?: boolean;
}): ReactElement {
  // 既定で閉じている（§12.3）
  const [transcriptOpen, setTranscriptOpen] = useState(false);
  const speakers = useMemo(() => speakersSoFar(view.lines), [view.lines]);

  return (
    <section className="astra-meeting" aria-label={`会議 ${title}`}>
      <RecordingIndicator
        state={state}
        title={title}
        elapsedMs={elapsedMs}
        speakers={speakers}
        onPause={onPause}
        onStop={onStop}
      />

      {/* §19: 確定した発言だけを、間隔を空けて読み上げへ渡す */}
      <LiveAnnouncer lines={view.lines} enabled={announceTranscript} />

      <div className="astra-meeting__body" data-transcript={transcriptOpen ? 'open' : 'closed'}>
        <div className="astra-meeting__notes">
          <label className="astra-meeting__notes-label" htmlFor="astra-meeting-notes">
            Notes
          </label>
          <textarea
            id="astra-meeting-notes"
            value={notes}
            placeholder="メモ"
            onChange={(e) => onNotesChange(e.target.value)}
          />
          <div className="astra-meeting__markers">
            {MARKERS.map((m) => (
              <button
                key={m.id}
                type="button"
                className="astra-meeting__marker"
                data-kind={m.id}
                onClick={() => onMark(m.id)}
              >
                <span className="astra-meeting__marker-dot" aria-hidden="true" />
                {m.label}
              </button>
            ))}
            <button
              type="button"
              className="astra-meeting__transcript-toggle"
              aria-expanded={transcriptOpen}
              onClick={() => setTranscriptOpen((open) => !open)}
            >
              Transcript
            </button>
          </div>
        </div>

        {transcriptOpen ? (
          <aside className="astra-meeting__transcript">
            <TranscriptPanel
              lines={view.lines}
              names={speakerNames}
              onNameSpeaker={onNameSpeaker}
            />
          </aside>
        ) : null}
      </div>
    </section>
  );
}
