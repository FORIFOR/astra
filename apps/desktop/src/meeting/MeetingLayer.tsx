/**
 * 会議を shell の上に重ねる層。UI/UX §12。
 *
 * live の間は最小の indicator だけを常に出し、押されたときに surface を開く。
 * 巨大な録音画面を常駐させない（§12）。
 */
import { useState, type ReactElement } from 'react';
import { Finalizing } from './Finalizing.js';
import { MeetingSurface } from './MeetingSurface.js';
import { RecordingIndicator } from './RecordingIndicator.js';
import { StartConfirmation } from './StartConfirmation.js';
import { speakersSoFar } from './meetingView.js';
import { useMeeting } from './MeetingProvider.js';
import './meeting.css';

export function MeetingLayer({
  onOpenWork,
}: {
  onOpenWork?(taskId: string): void;
}): ReactElement | null {
  const meeting = useMeeting();
  const [expanded, setExpanded] = useState(false);

  if (meeting.phase === 'idle') {
    return meeting.error ? (
      <div className="astra-meeting-layer" role="alert">
        <p>会議を開始できませんでした。{meeting.error}</p>
      </div>
    ) : null;
  }

  if (meeting.phase === 'starting') {
    return (
      <div className="astra-meeting-layer" data-phase="starting">
        <StartConfirmation
          onCancel={meeting.cancelStart}
          onStart={(values) => void meeting.start(values)}
        />
      </div>
    );
  }

  if (meeting.phase === 'finalizing') {
    return (
      <div className="astra-meeting-layer" data-phase="finalizing">
        <Finalizing
          title={meeting.meeting?.title ?? '会議'}
          completedSteps={0}
          onOpenWork={() => {
            if (meeting.finalizeTaskId) onOpenWork?.(meeting.finalizeTaskId);
            meeting.dismiss();
          }}
        />
      </div>
    );
  }

  const title = meeting.meeting?.title ?? '会議';

  return (
    <div className="astra-meeting-layer" data-phase="live">
      {expanded ? (
        <MeetingSurface
          title={title}
          view={meeting.view}
          elapsedMs={meeting.elapsedMs}
          state={meeting.state}
          notes={meeting.notes}
          speakerNames={meeting.speakerNames}
          onNotesChange={meeting.setNotes}
          onMark={() => {
            /* marker は UI-5 で Notes へ落とす。ここでは印だけ。 */
          }}
          onNameSpeaker={(speakerTag) => {
            const name = window.prompt(`Speaker ${speakerTag} の名前`);
            if (name) void meeting.nameSpeaker(speakerTag, name);
          }}
          onPause={meeting.togglePause}
          onStop={() => void meeting.stop()}
        />
      ) : (
        <button
          type="button"
          className="astra-meeting-layer__collapsed"
          onClick={() => setExpanded(true)}
          aria-label={`${title} の画面を開く`}
        >
          <RecordingIndicator
            state={meeting.state}
            title={title}
            elapsedMs={meeting.elapsedMs}
            speakers={speakersSoFar(meeting.view.lines)}
            onPause={meeting.togglePause}
            onStop={() => void meeting.stop()}
          />
        </button>
      )}
      {expanded ? (
        <button type="button" onClick={() => setExpanded(false)}>
          最小化
        </button>
      ) : null}
    </div>
  );
}
