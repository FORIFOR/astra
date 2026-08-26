/**
 * 議事録。UI/UX §12.6。
 *
 * 引用番号を押すと、該当の transcript 行へ跳ぶ。
 * **跳べない引用は出さない**（作った側で落としてある。Phase 3 §5）。
 */
import { useState, type ReactElement } from 'react';
import type { MeetingBundle, MeetingSegment } from '@astra/contracts';
import { speakerLabel } from './meetingView.js';

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
  const indexOf = new Map(segments.map((s, i) => [String(s.id), i + 1]));

  const cite = (citations: readonly { segment_id: string; start_ms: number }[]) =>
    citations.map((c) => (
      <button
        key={c.segment_id}
        type="button"
        className="astra-bundle__cite"
        aria-label={`根拠 ${indexOf.get(String(c.segment_id)) ?? '?'} を見る`}
        onClick={() => setFocused(String(c.segment_id))}
      >
        [{indexOf.get(String(c.segment_id)) ?? '?'}]
      </button>
    ));

  const section = (
    heading: string,
    items: readonly {
      text: string;
      citations: readonly { segment_id: string; start_ms: number }[];
    }[],
  ) =>
    items.length === 0 ? null : (
      <section className="astra-bundle__section">
        <h3>{heading}</h3>
        <ul>
          {items.map((item, i) => (
            <li key={`${heading}-${i}`}>
              {item.text} {cite(item.citations)}
            </li>
          ))}
        </ul>
      </section>
    );

  const focusedSegment = focused ? segments.find((s) => String(s.id) === focused) : undefined;

  return (
    <article className="astra-bundle" aria-label={`議事録 ${bundle.title}`}>
      <header className="astra-bundle__head">
        <h2>{bundle.title}</h2>
        <p>
          {Math.round(bundle.duration_ms / 60_000)} 分 · {bundle.speaker_count} participants
        </p>
      </header>

      {section('要点', bundle.summary)}
      {section('決定事項', bundle.decisions)}
      {section('ToDo', bundle.action_items)}
      {section('未解決', bundle.open_questions)}

      {focusedSegment ? (
        <aside className="astra-bundle__evidence" aria-label="根拠">
          <p className="astra-bundle__evidence-at">{timeLabel(focusedSegment.start_ms)}</p>
          <p className="astra-bundle__evidence-who">
            {speakerLabel(focusedSegment.speaker_tag, names)}
          </p>
          <p className="astra-bundle__evidence-text">{focusedSegment.text}</p>
        </aside>
      ) : null}
    </article>
  );
}

function timeLabel(ms: number): string {
  const total = Math.floor(ms / 1000);
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}
