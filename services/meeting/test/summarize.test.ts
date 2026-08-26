import { describe, expect, it } from 'vitest';
import { uuidv7, type MeetingSegment } from '@astra/contracts';
import { durationMs, speakerCount, withCitations } from '../src/summarize.js';
import { renderBundle } from '../src/executor.js';

const seg = (over: Partial<MeetingSegment> = {}): MeetingSegment =>
  ({
    id: uuidv7(),
    meeting_id: uuidv7(),
    pass: 'final',
    speaker_tag: 1,
    text: '本文',
    start_ms: 0,
    end_ms: 1_000,
    language: 'ja-JP',
    confidence: 0.9,
    supersedes: [],
    created_at: new Date().toISOString(),
    ...over,
  }) as MeetingSegment;

describe('withCitations', () => {
  it('drops a citation that points at no real segment', () => {
    // モデルが id を作り話しても、跳べない引用を UI に出さない
    const real = seg();
    const out = withCitations(
      {
        summary: [{ text: '本物', segmentIds: [String(real.id)] }],
        decisions: [{ text: '作り話', segmentIds: [uuidv7()] }],
        actionItems: [],
        openQuestions: [],
      },
      [real],
    );
    expect(out.summary).toHaveLength(1);
    expect(out.decisions).toHaveLength(0);
    expect(out.dropped).toBe(1);
  });

  it('keeps the start time so the reader can jump there', () => {
    const s = seg({ start_ms: 42_000 });
    const out = withCitations(
      {
        summary: [{ text: 'x', segmentIds: [String(s.id)] }],
        decisions: [],
        actionItems: [],
        openQuestions: [],
      },
      [s],
    );
    expect(out.summary[0]!.citations[0]!.start_ms).toBe(42_000);
  });

  it('does not invent an assignee', () => {
    const s = seg();
    const out = withCitations(
      {
        summary: [],
        decisions: [],
        actionItems: [{ text: '見積を送る', segmentIds: [String(s.id)] }],
        openQuestions: [],
      },
      [s],
    );
    expect(out.actionItems[0]!.assignee).toBeNull();
  });
});

describe('counting', () => {
  it('counts distinct speakers and ignores unknown ones', () => {
    expect(
      speakerCount([seg({ speaker_tag: 1 }), seg({ speaker_tag: 2 }), seg({ speaker_tag: 1 })]),
    ).toBe(2);
    expect(speakerCount([seg({ speaker_tag: null })])).toBe(0);
  });

  it('takes the duration from the last thing said', () => {
    expect(durationMs([seg({ end_ms: 1_000 }), seg({ end_ms: 9_000 })])).toBe(9_000);
    expect(durationMs([])).toBe(0);
  });
});

describe('renderBundle', () => {
  it('puts the conclusion before the transcript and names known speakers', () => {
    const a = seg({ speaker_tag: 1, text: '10 月で行きましょう', start_ms: 65_000 });
    const body = renderBundle(
      {
        meeting_id: a.meeting_id,
        title: '定例',
        duration_ms: 66_000,
        speaker_count: 1,
        summary: [],
        decisions: [{ text: '10 月導入', citations: [{ segment_id: a.id, start_ms: a.start_ms }] }],
        action_items: [],
        open_questions: [],
      },
      [a],
      [{ speaker_tag: 1, display_name: '田中' }],
    );

    expect(body.indexOf('## 決定事項')).toBeLessThan(body.indexOf('## Transcript'));
    expect(body).toContain('- 10 月導入 [1]');
    expect(body).toContain('1. `01:05` **田中**');
  });

  it('falls back to the speaker number when nobody named them', () => {
    const a = seg({ speaker_tag: 3 });
    const body = renderBundle(
      {
        meeting_id: a.meeting_id,
        title: '定例',
        duration_ms: 1_000,
        speaker_count: 1,
        summary: [],
        decisions: [],
        action_items: [],
        open_questions: [],
      },
      [a],
      [],
    );
    expect(body).toContain('**Speaker 3**');
  });
});
