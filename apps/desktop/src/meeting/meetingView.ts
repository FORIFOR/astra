/**
 * 会議の表示状態。UI/UX §12.4。
 *
 * 受け取ったイベントを畳み込むだけの純粋関数にしてある。
 * 画面のコードに「interim をどう混ぜるか」の判断を持ち込むと、
 * 揺れる条件を目で追えなくなる。
 */
import type { EventEnvelope } from '@astra/contracts';

export interface TranscriptLine {
  readonly id: string;
  readonly speakerTag: number | null;
  readonly text: string;
  readonly startMs: number;
  readonly endMs: number;
  /** 確定前。UI/UX §12.4 は淡色で出すことを求める。 */
  readonly interim: boolean;
  readonly translation: string | null;
}

export interface MeetingView {
  readonly lines: readonly TranscriptLine[];
  readonly ended: boolean;
  /** 終了後の続きを追える先。UI/UX §12.5。 */
  readonly finalizeTaskId: string | null;
}

export const emptyMeetingView: MeetingView = {
  lines: [],
  ended: false,
  finalizeTaskId: null,
};

/**
 * イベントを 1 つ畳み込む。
 *
 * interim は**同じ話者の末尾 1 行だけ**を差し替える。行を積むと画面が伸び続け、
 * 確定のたびに位置が跳ぶ。確定が来たら interim を捨てて確定行を積む。
 */
export function applyMeetingEvent(view: MeetingView, event: EventEnvelope): MeetingView {
  switch (event.type) {
    case 'meeting.transcript.partial': {
      const p = event.payload;
      const settled = view.lines.filter((l) => !l.interim);
      return {
        ...view,
        lines: [
          ...settled,
          {
            id: p.segment_id,
            speakerTag: p.speaker_tag,
            text: p.text,
            startMs: p.start_ms,
            endMs: p.end_ms,
            interim: true,
            translation: null,
          },
        ],
      };
    }

    case 'meeting.transcript.final': {
      const p = event.payload;
      const settled = view.lines.filter((l) => !l.interim);
      // 同じ segment が再送されても増やさない
      if (settled.some((l) => l.id === p.segment_id)) return { ...view, lines: settled };
      return {
        ...view,
        lines: [
          ...settled,
          {
            id: p.segment_id,
            speakerTag: p.speaker_tag,
            text: p.text,
            startMs: p.start_ms,
            endMs: p.end_ms,
            interim: false,
            translation: null,
          },
        ],
      };
    }

    case 'meeting.translation.final': {
      const p = event.payload;
      return {
        ...view,
        lines: view.lines.map((l) => (l.id === p.segment_id ? { ...l, translation: p.text } : l)),
      };
    }

    case 'meeting.ended': {
      const p = event.payload;
      return {
        // 終わったら未確定を残さない
        lines: view.lines.filter((l) => !l.interim),
        ended: true,
        finalizeTaskId: p.finalize_task_id,
      };
    }

    default:
      return view;
  }
}

/** 経過時間の表示。`18:42` の形（UI/UX §12.2）。 */
export function elapsedLabel(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  if (minutes < 60) return `${minutes}:${String(seconds).padStart(2, '0')}`;
  const hours = Math.floor(minutes / 60);
  return `${hours}:${String(minutes % 60).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

/** 話者の見せ方。名前が無ければ番号。**勝手に名前を推測しない。** */
export function speakerLabel(
  speakerTag: number | null,
  names: ReadonlyMap<number, string>,
): string {
  if (speakerTag === null) return '不明';
  return names.get(speakerTag) ?? `Speaker ${speakerTag}`;
}

/** 何人が喋ったか。indicator の「3 speakers」（UI/UX §12.2）。 */
export function speakersSoFar(lines: readonly TranscriptLine[]): number {
  return new Set(
    lines
      .filter((l) => !l.interim)
      .map((l) => l.speakerTag)
      .filter((t) => t !== null),
  ).size;
}
