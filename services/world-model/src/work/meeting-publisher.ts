/**
 * 会議 → Work Graph（MEETING_WORK_LOOP_GATE）。
 *
 *   会議の finalize → bundle（決定 / やること、発言への引用つき）→ ここ → work_artifacts（upsert）→ Work Graph
 *   → 次の会議の brief / 翌朝の Home
 *
 * **id は安定**: `meeting:<meetingId>:decision:<segmentId>` / `meeting:<meetingId>:action:<segmentId>`。
 * 再起動・Recovery・再 finalize・Live Notes の修正でも同じ id へ upsert するので件数は増えない（revision）。
 * 出所は発言そのもの（話者・時刻・文字起こし・音源）。
 */
import type {
  MeetingActionItem,
  MeetingBundle,
  MeetingClaim,
  MeetingSegment,
  WorkArtifact,
} from '@astra/contracts';
import { extractDeadline } from './deadline.js';

export interface MeetingPublishInput {
  readonly meetingId: string;
  readonly title: string;
  readonly startedAt: string;
  readonly endedAt: string | null;
  readonly bundle: MeetingBundle;
  readonly segments: readonly MeetingSegment[];
  readonly speakers: readonly { speaker_tag: number; display_name: string }[];
  readonly projectHint: string | null;
  readonly recordingArtifactId: string | null;
  readonly transcriptArtifactId: string | null;
  readonly observedAt: string;
  /** 本人が Live Notes で認めた claim の segment id。無ければ inferred。 */
  readonly confirmedSegmentIds?: readonly string[];
}

export function stableMeetingArtifactId(
  meetingId: string,
  kind: 'decision' | 'action',
  segmentId: string,
): string {
  return `meeting:${meetingId}:${kind}:${segmentId}`;
}

function firstCitation(claim: MeetingClaim): { segment_id: string; start_ms: number } | null {
  return claim.citations[0] ?? null;
}

function speakerOf(
  segmentId: string,
  segments: readonly MeetingSegment[],
  speakers: readonly { speaker_tag: number; display_name: string }[],
): string | null {
  const seg = segments.find((s) => String(s.id) === String(segmentId));
  if (!seg || seg.speaker_tag === null) return null;
  return (
    speakers.find((sp) => sp.speaker_tag === seg.speaker_tag)?.display_name ??
    `Speaker ${String(seg.speaker_tag)}`
  );
}

function occurredAt(startedAt: string, startMs: number): string {
  const base = Date.parse(startedAt);
  return Number.isFinite(base) ? new Date(base + startMs).toISOString() : startedAt;
}

/** bundle → artifact。引用の無い claim は流さない（発言に戻れないものを事実にしない）。 */
export function meetingArtifacts(input: MeetingPublishInput): WorkArtifact[] {
  const out: WorkArtifact[] = [];
  const confirmed = new Set(input.confirmedSegmentIds ?? []);
  const project = input.projectHint ?? null;
  const excerptOf = (text: string): string => (text.length > 200 ? text.slice(0, 200) : text);

  const origin = (segmentId: string, startMs: number) => ({
    meeting_id: input.meetingId,
    segment_id: segmentId,
    speaker: speakerOf(segmentId, input.segments, input.speakers),
    start_ms: startMs,
    transcript_artifact_id: input.transcriptArtifactId,
    audio_artifact_id: input.recordingArtifactId,
    status: confirmed.has(segmentId) ? ('confirmed' as const) : ('inferred' as const),
  });

  for (const d of input.bundle.decisions) {
    const c = firstCitation(d);
    if (!c) continue;
    const who = speakerOf(c.segment_id, input.segments, input.speakers);
    out.push({
      id: stableMeetingArtifactId(input.meetingId, 'decision', c.segment_id),
      source: 'meeting',
      kind: 'decision',
      title: d.text.slice(0, 500),
      body_excerpt: null,
      people: who ? [{ name: who, email: null, role: 'mentioned' }] : [],
      direction: 'self',
      occurred_at: occurredAt(input.startedAt, c.start_ms),
      ends_at: null,
      due_at: null,
      thread_id: null,
      project_hint: project,
      responded: null,
      completed: null,
      provenance: {
        source: 'meeting',
        external_id: input.meetingId,
        label: input.title,
        observed_at: input.observedAt,
        url: null,
        excerpt: excerptOf(`${who ? `${who}: ` : ''}${d.text}`),
      },
      semantic: {
        category: 'info',
        project,
        request: d.text.slice(0, 300),
        owner: null,
        waiting_on: null,
        due: null,
        confidence: confirmed.has(c.segment_id) ? 1 : 0.8,
        extracted_by: 'llm',
      },
      origin: origin(c.segment_id, c.start_ms),
    });
  }

  for (const a of input.bundle.action_items as readonly MeetingActionItem[]) {
    const c = firstCitation(a);
    if (!c) continue;
    const who = speakerOf(c.segment_id, input.segments, input.speakers);
    const now = new Date(occurredAt(input.startedAt, c.start_ms));
    const due = a.due ? (extractDeadline(a.due, now)?.at ?? null) : null;
    const assignee = a.assignee ?? null;
    out.push({
      id: stableMeetingArtifactId(input.meetingId, 'action', c.segment_id),
      source: 'meeting',
      kind: 'action_item',
      title: a.text.slice(0, 500),
      body_excerpt: null,
      people: [
        ...(assignee ? [{ name: assignee, email: null, role: 'assignee' as const }] : []),
        ...(who && who !== assignee
          ? [{ name: who, email: null, role: 'mentioned' as const }]
          : []),
      ],
      direction: 'self',
      occurred_at: occurredAt(input.startedAt, c.start_ms),
      ends_at: null,
      due_at: due,
      thread_id: null,
      project_hint: project,
      responded: null,
      completed: false,
      provenance: {
        source: 'meeting',
        external_id: input.meetingId,
        label: input.title,
        observed_at: input.observedAt,
        url: null,
        excerpt: excerptOf(`${who ? `${who}: ` : ''}${a.text}${a.due ? `（${a.due}）` : ''}`),
      },
      semantic: {
        category: 'request_to_me',
        project,
        request: a.text.slice(0, 300),
        owner: assignee ?? 'me',
        waiting_on: null,
        due,
        confidence: confirmed.has(c.segment_id) ? 1 : 0.8,
        extracted_by: 'llm',
      },
      origin: origin(c.segment_id, c.start_ms),
    });
  }
  return out;
}
