/**
 * MEETING_WORK_LOOP_GATE の純粋部分。
 *   会議の bundle → 安定 id の artifact（決定 / やること、発言への出所）→ Work Graph → 次の brief / Home
 */
import { describe, expect, it } from 'vitest';
import type { MeetingBundle, MeetingSegment, WorkArtifact } from '@astra/contracts';
import {
  buildMeetingBrief,
  buildWorkContext,
  meetingArtifacts,
  stableMeetingArtifactId,
} from '../src/index.js';

const NOW = new Date('2026-09-07T09:00:00+09:00');
const iso = (d: string): string => new Date(d).toISOString();
const STARTED = iso('2026-09-03T15:00:00+09:00');

const seg = (id: string, tag: number | null, text: string, startMs: number): MeetingSegment => ({
  id: id as never,
  meeting_id: 'mt-1' as never,
  pass: 'final',
  source: tag === 1 ? 'microphone' : 'system',
  speaker_tag: tag,
  text,
  start_ms: startMs,
  end_ms: startMs + 4000,
  language: 'ja',
  confidence: 0.9,
  supersedes: [],
  created_at: STARTED,
});
const segments = [
  seg('s1', 2, '価格案を再提出することにしましょう', 600_000),
  seg('s2', 1, '見積を 9/9 までに送ります', 620_000),
  seg('s3', 2, '導入時期は社内で確認します', 640_000),
];
const speakers = [
  { speaker_tag: 1, display_name: '自分' },
  { speaker_tag: 2, display_name: 'MTI 田中' },
];
const bundle: MeetingBundle = {
  meeting_id: 'mt-1' as never,
  title: 'MOPITA 定例',
  duration_ms: 3_600_000,
  speaker_count: 2,
  summary: [],
  decisions: [
    { text: '価格案を再提出する', citations: [{ segment_id: 's1' as never, start_ms: 600_000 }] },
  ],
  action_items: [
    {
      text: '見積を 9/9 までに送る',
      citations: [{ segment_id: 's2' as never, start_ms: 620_000 }],
      assignee: '自分',
      due: '9/9',
    },
    { text: '引用の無いやること', citations: [] as never, assignee: null, due: null },
  ],
  open_questions: [],
};

function publish(): WorkArtifact[] {
  return meetingArtifacts({
    meetingId: 'mt-1',
    title: 'MOPITA 定例',
    startedAt: STARTED,
    endedAt: null,
    bundle,
    segments,
    speakers,
    projectHint: 'MOPITA連携',
    recordingArtifactId: 'art-audio',
    transcriptArtifactId: 'art-transcript',
    observedAt: iso('2026-09-03T16:10:00+09:00'),
  });
}

describe('meeting → work graph', () => {
  it('turns decisions and actions into artifacts with stable ids and speaker / time / source provenance', () => {
    const out = publish();
    expect(out.map((a) => a.id)).toEqual([
      stableMeetingArtifactId('mt-1', 'decision', 's1'),
      stableMeetingArtifactId('mt-1', 'action', 's2'),
    ]);
    const [decision, action] = out;
    expect(decision!.kind).toBe('decision');
    expect(decision!.origin).toMatchObject({
      meeting_id: 'mt-1',
      segment_id: 's1',
      speaker: 'MTI 田中',
      start_ms: 600_000,
      audio_artifact_id: 'art-audio',
      transcript_artifact_id: 'art-transcript',
      status: 'inferred',
    });
    expect(decision!.provenance.excerpt).toContain('MTI 田中: 価格案');
    expect(decision!.occurred_at).toBe(iso('2026-09-03T15:10:00+09:00'));
    expect(action!.kind).toBe('action_item');
    expect(action!.due_at).toBe(iso('2026-09-09T18:00:00+09:00'));
    expect(action!.semantic?.owner).toBe('自分');
    expect(action!.completed).toBe(false);
    // 引用の無いやることは流さない（発言に戻れない）
    expect(out.some((a) => a.title.includes('引用の無い'))).toBe(false);
  });

  it('re-finalizing yields the same ids (duplicate 0), and an edited claim keeps its id', () => {
    const first = publish();
    const again = publish();
    expect(again.map((a) => a.id)).toEqual(first.map((a) => a.id));
    const edited = meetingArtifacts({
      meetingId: 'mt-1',
      title: 'MOPITA 定例',
      startedAt: STARTED,
      endedAt: null,
      bundle: {
        ...bundle,
        decisions: [
          {
            text: '価格案を再提出する（Standard プラン）',
            citations: bundle.decisions[0]!.citations,
          },
        ],
      },
      segments,
      speakers,
      projectHint: 'MOPITA連携',
      recordingArtifactId: null,
      transcriptArtifactId: null,
      observedAt: iso('2026-09-04T09:00:00+09:00'),
      confirmedSegmentIds: ['s1'],
    });
    expect(edited[0]!.id).toBe(first[0]!.id);
    expect(edited[0]!.title).toContain('Standard');
    expect(edited[0]!.origin?.status).toBe('confirmed');
    expect(edited[0]!.semantic?.confidence).toBe(1);
  });

  it('the next brief sees the decision and the open action, and Home ranks the action', () => {
    const published = publish();
    const meetingAnchor: WorkArtifact = {
      id: 'meeting:mt-1',
      source: 'meeting',
      kind: 'meeting',
      title: 'MOPITA 定例',
      body_excerpt: null,
      people: [],
      direction: 'self',
      occurred_at: STARTED,
      ends_at: null,
      due_at: null,
      thread_id: null,
      project_hint: 'MOPITA連携',
      responded: null,
      completed: null,
      provenance: {
        source: 'meeting',
        external_id: 'mt-1',
        label: 'MOPITA 定例',
        observed_at: STARTED,
        url: null,
        excerpt: null,
      },
      semantic: null,
      origin: null,
    };
    const next: WorkArtifact = {
      ...meetingAnchor,
      id: 'google_calendar:ev-2',
      source: 'google_calendar',
      kind: 'calendar_event',
      occurred_at: iso('2026-09-07T15:00:00+09:00'),
      ends_at: iso('2026-09-07T16:00:00+09:00'),
      provenance: { ...meetingAnchor.provenance, source: 'google_calendar', external_id: 'ev-2' },
    };
    const artifacts = [meetingAnchor, next, ...published];
    const ctx = buildWorkContext({ artifacts, corrections: [], now: NOW, inferenceEnabled: true });
    expect(ctx.priorities.map((p) => p.project)).toContain('MOPITA連携');
    const top = ctx.priorities.find((p) => p.project === 'MOPITA連携')!;
    expect(top.due_at).toBe(iso('2026-09-09T18:00:00+09:00'));
    expect(top.sources.some((s) => s.source === 'meeting')).toBe(true);
    const brief = buildMeetingBrief({ artifacts, context: ctx, now: NOW });
    expect(brief?.previous.map((p) => p.text)).toEqual(
      expect.arrayContaining([
        expect.stringContaining('決定: 価格案を再提出する'),
        expect.stringContaining('やること: 見積を 9/9 までに送る'),
      ]),
    );
    expect(
      brief?.suggested_questions.some((q) => q.question.includes('見積を 9/9 までに送る')),
    ).toBe(true);
  });
});
