/**
 * 議事録。UI/UX §12.6。
 *
 * 引用番号を押すと、該当の transcript 行へ跳ぶ。
 * **跳べない引用は出さない**（作った側で落としてある。Phase 3 §5）。
 */
import { useState, type ReactElement } from 'react';
import type { MeetingBundle, MeetingSegment } from '@astra/contracts';
import { speakerLabel } from './meetingView.js';
import { TranscriptPanel } from './TranscriptPanel.js';

type Pane = 'transcript' | 'recording' | 'files' | 'evidence';

const PANES: { id: Pane; label: string }[] = [
  { id: 'transcript', label: 'Transcript' },
  { id: 'recording', label: '録音' },
  { id: 'files', label: '関連ファイル' },
  { id: 'evidence', label: '根拠' },
];

/** §12.6 の「42:18 · 3 participants」 */
export function durationLabel(ms: number): string {
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const sec = total % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
    : `${m}:${String(sec).padStart(2, '0')}`;
}

export function MeetingArtifact({
  bundle,
  segments,
  names,
}: {
  bundle: MeetingBundle;
  segments: readonly MeetingSegment[];
  names: ReadonlyMap<number, string>;
}): ReactElement {
  const [focused, setFocused] = useState<string | null>(null);
  const [pane, setPane] = useState<Pane | null>(null);
  const indexOf = new Map(segments.map((s, i) => [String(s.id), i + 1]));

  const cite = (citations: readonly { segment_id: string; start_ms: number }[]) =>
    citations.map((c) => (
      <button
        key={c.segment_id}
        type="button"
        className="astra-bundle__cite"
        aria-label={`根拠 ${indexOf.get(String(c.segment_id)) ?? '?'} を見る`}
        onClick={() => {
          setFocused(String(c.segment_id));
          setPane('evidence');
        }}
      >
        [{indexOf.get(String(c.segment_id)) ?? '?'}]
      </button>
    ));

  const section = (
    heading: string,
    items: readonly {
      text: string;
      citations: readonly { segment_id: string; start_ms: number }[];
      owner?: string | null;
      due?: string | null;
    }[],
    countable = true,
  ) =>
    items.length === 0 ? null : (
      <section className="astra-bundle__section">
        <h3>
          {heading}
          {/* §12.6: 「Decisions 3」「Action items 4」— 数を見出しに */}
          {countable && <span className="astra-bundle__count">{items.length}</span>}
        </h3>
        <ul>
          {items.map((item, i) => (
            <li key={`${heading}-${i}`}>
              {/* ToDo は「誰が / 何を / いつまでに」。分からない欄は空のまま（埋めない） */}
              {item.owner ? <span className="astra-bundle__owner">{item.owner}</span> : null}
              <span className="astra-bundle__text">{item.text}</span>
              {item.due ? <span className="astra-bundle__due">{item.due}</span> : null}
              <span className="astra-bundle__cites">{cite(item.citations)}</span>
            </li>
          ))}
        </ul>
      </section>
    );

  const focusedSegment = focused ? segments.find((s) => String(s.id) === focused) : undefined;
  const lines = segments.map((seg) => ({
    id: String(seg.id),
    speakerTag: seg.speaker_tag,
    text: seg.text,
    startMs: seg.start_ms,
    endMs: seg.end_ms,
    interim: false,
    translation: null,
  }));

  return (
    <article className="astra-bundle" aria-label={`議事録 ${bundle.title}`}>
      <header className="astra-bundle__head">
        <h2>{bundle.title}</h2>
        <p>
          {durationLabel(bundle.duration_ms)} · {bundle.speaker_count} participants
        </p>
      </header>

      <div className="astra-bundle__body" data-pane={pane ?? 'none'}>
        <div className="astra-bundle__main">
          {section('Summary', bundle.summary, false)}
          {section('Decisions', bundle.decisions)}
          {section('Action items', bundle.action_items)}
          {section('Open questions', bundle.open_questions)}
        </div>

        {/* §12.6: [Transcript] [Recording] [Related files] [Evidence] */}
        <nav className="astra-bundle__panes" aria-label="会議の記録">
          {PANES.map((p) => (
            <button
              key={p.id}
              type="button"
              className="astra-bundle__pane"
              aria-pressed={pane === p.id}
              onClick={() => setPane((current) => (current === p.id ? null : p.id))}
            >
              {p.label}
              {p.id === 'transcript' && (
                <span className="astra-bundle__pane-count">{segments.length}</span>
              )}
            </button>
          ))}
        </nav>
      </div>

      {pane === 'transcript' && (
        <aside className="astra-bundle__panel" aria-label="Transcript">
          <TranscriptPanel lines={lines} names={names} />
        </aside>
      )}
      {pane === 'recording' && (
        <aside className="astra-bundle__panel" aria-label="録音">
          <p className="astra-bundle__panel-note">
            録音はこの端末に保存されています。引用番号から該当位置へ跳べます。
          </p>
        </aside>
      )}
      {pane === 'files' && (
        <aside className="astra-bundle__panel" aria-label="関連ファイル">
          <p className="astra-bundle__panel-note">この会議に添えられたファイルはありません。</p>
        </aside>
      )}
      {pane === 'evidence' && (
        <aside className="astra-bundle__panel astra-bundle__evidence" aria-label="根拠">
          {focusedSegment ? (
            <>
              {/* AC-09: 引用 → 該当 transcript + timestamp + 音声位置 */}
              <p className="astra-bundle__evidence-at">
                <span aria-hidden="true">▶</span> {timeLabel(focusedSegment.start_ms)}
                <span className="astra-bundle__evidence-num">
                  [{indexOf.get(String(focusedSegment.id)) ?? '?'}]
                </span>
              </p>
              <p className="astra-bundle__evidence-who">
                {speakerLabel(focusedSegment.speaker_tag, names)}
              </p>
              <p className="astra-bundle__evidence-text">{focusedSegment.text}</p>
            </>
          ) : (
            <p className="astra-bundle__panel-note">
              要点の引用番号を押すと、その発言がここに出ます。
            </p>
          )}
        </aside>
      )}
    </article>
  );
}

function timeLabel(ms: number): string {
  const total = Math.floor(ms / 1000);
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}
