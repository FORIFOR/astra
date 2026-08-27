/**
 * 会議を shell の上に重ねる層。UI/UX §12。
 *
 * live の間は最小の indicator だけを常に出し、押されたときに surface を開く。
 * 巨大な録音画面を常駐させない（§12）。
 */
import { useEffect, useState, type ReactElement } from 'react';
import { Finalizing } from './Finalizing.js';
import { MeetingSurface } from './MeetingSurface.js';
import { RecordingIndicator } from './RecordingIndicator.js';
import { StartConfirmation } from './StartConfirmation.js';
import { speakersSoFar } from './meetingView.js';
import { useMeeting } from './MeetingProvider.js';
import { useOptionalShell } from '../state/ShellProvider.js';
import './meeting.css';

export function MeetingLayer({
  onOpenWork,
}: {
  onOpenWork?(taskId: string): void;
}): ReactElement | null {
  const meeting = useMeeting();
  const [expanded, setExpanded] = useState(false);
  const activeTab = useOptionalShell()?.activeTab ?? null;

  // 開始確認は「今の判断」。タブを移ったら、その判断は流れたものとして閉じる。
  // 残しておくと Library や Apps の上に居座り、閉じ方が分からなくなる。
  const { phase, cancelStart } = meeting;
  useEffect(() => {
    if (phase === 'starting') cancelStart();
    // activeTab が変わったときだけ。phase の変化では閉じない
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab]);

  if (meeting.phase === 'idle') {
    // 前回落ちたまま手元に残っている録音。黙って捨てない。送り直すか捨てるかを聞く
    const recovery =
      meeting.recoverable.length > 0 ? (
        <div className="astra-meeting-layer astra-meeting-layer--recovery" role="status">
          {meeting.recoverable.map((item) => (
            <p key={item.meetingId} className="astra-meeting-recovery">
              <span>
                前回の録音が手元に残っています（約 {Math.round(item.recordedMs / 60_000)} 分、
                送信済み {Math.round(item.uploadedMs / 60_000)} 分）。
              </span>
              <button type="button" onClick={() => void meeting.reupload(item.meetingId)}>
                送り直す
              </button>
              <button type="button" onClick={() => void meeting.discardRecovery(item.meetingId)}>
                捨てる
              </button>
            </p>
          ))}
        </div>
      ) : null;
    return meeting.error ? (
      <>
        {recovery}
        <div className="astra-meeting-layer" role="alert">
          <p>会議を開始できませんでした。{meeting.error}</p>
        </div>
      </>
    ) : (
      recovery
    );
  }

  if (meeting.phase === 'starting') {
    return (
      <div className="astra-meeting-layer astra-meeting-layer--sheet" data-phase="starting">
        {/* 開始確認は 1 つの判断。画面の真ん中で、他を薄くして聞く。 */}
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
      {/* 端末で音を取り込めていない / 回線が切れている。録音の成否に関わるので隠さない */}
      {meeting.captureError && (
        <p className="astra-meeting-layer__notice" role="alert">
          {meeting.captureError}
        </p>
      )}
      {(meeting.link === 'offline' || meeting.link === 'reconnecting') && (
        <p className="astra-meeting-layer__notice" role="status">
          送り先に届いていません。音は手元に残しています（未送信 約{' '}
          {Math.ceil(meeting.pendingMs / 1000)} 秒）。戻り次第、続きから送ります。
        </p>
      )}
    </div>
  );
}
