import { describe, expect, it } from 'vitest';
import {
  CreateMeetingRequest,
  MeetingBundle,
  MeetingClaim,
  MeetingControlMessage,
  MeetingSegment,
  NameSpeakerRequest,
  uuidv7,
} from '../src/index.js';

describe('starting a meeting', () => {
  it('refuses to start without a confirmed consent', () => {
    // 参加者の同意を確認していない録音を始めさせない（UI/UX §12.1）
    expect(CreateMeetingRequest.safeParse({ title: '定例' }).success).toBe(false);
    expect(
      CreateMeetingRequest.safeParse({ title: '定例', consent_confirmed: false }).success,
    ).toBe(false);
  });

  it('records at least one audio source, defaulting to the microphone', () => {
    const req = CreateMeetingRequest.parse({ title: '定例', consent_confirmed: true });
    expect(req.audio_sources).toEqual(['microphone']);
    expect(req.language).toBe('ja-JP');
    // 翻訳は既定で off
    expect(req.target_language).toBeNull();

    expect(
      CreateMeetingRequest.safeParse({
        title: '定例',
        consent_confirmed: true,
        audio_sources: [],
      }).success,
    ).toBe(false);
  });
});

describe('a transcript segment', () => {
  const base = {
    id: uuidv7(),
    meeting_id: uuidv7(),
    speaker_tag: 1,
    text: '売上の話をします',
    start_ms: 0,
    end_ms: 2_400,
    language: 'ja-JP',
    confidence: 0.9,
    created_at: new Date().toISOString(),
  };

  it('belongs to exactly one pass', () => {
    expect(MeetingSegment.safeParse({ ...base, pass: 'live' }).success).toBe(true);
    expect(MeetingSegment.safeParse({ ...base, pass: 'final' }).success).toBe(true);
    // interim は保存しない（D-24）ので pass にも無い
    expect(MeetingSegment.safeParse({ ...base, pass: 'interim' }).success).toBe(false);
  });

  it('records which live segments a final one replaced', () => {
    const replaced = uuidv7();
    const seg = MeetingSegment.parse({ ...base, pass: 'final', supersedes: [replaced] });
    expect(seg.supersedes).toEqual([replaced]);
    // live 側は誰も置き換えない
    expect(MeetingSegment.parse({ ...base, pass: 'live' }).supersedes).toEqual([]);
  });

  it('allows an unknown speaker rather than guessing one', () => {
    expect(MeetingSegment.safeParse({ ...base, pass: 'live', speaker_tag: null }).success).toBe(
      true,
    );
    expect(MeetingSegment.safeParse({ ...base, pass: 'live', speaker_tag: 0 }).success).toBe(false);
  });
});

describe('the bundle', () => {
  it('refuses a claim with no citation', () => {
    // 根拠のない断定を作らない。引用から transcript へ跳べることが条件（AC3-9）
    expect(MeetingClaim.safeParse({ text: '10 月導入で合意', citations: [] }).success).toBe(false);
  });

  it('keeps an action item with an unknown assignee rather than inventing one', () => {
    const bundle = MeetingBundle.parse({
      meeting_id: uuidv7(),
      title: '定例',
      duration_ms: 1_000,
      speaker_count: 2,
      summary: [],
      decisions: [],
      action_items: [
        {
          text: '見積を送る',
          citations: [{ segment_id: uuidv7(), start_ms: 10 }],
        },
      ],
      open_questions: [],
    });
    expect(bundle.action_items[0]!.assignee).toBeNull();
  });
});

describe('the audio control channel', () => {
  it('takes pause, resume and markers', () => {
    expect(MeetingControlMessage.safeParse({ type: 'pause' }).success).toBe(true);
    expect(
      MeetingControlMessage.safeParse({ type: 'marker', kind: 'decision', at_ms: 1_000 }).success,
    ).toBe(true);
    expect(MeetingControlMessage.safeParse({ type: 'stop' }).success).toBe(false);
  });
});

describe('naming a speaker', () => {
  it('needs a tag and a name', () => {
    expect(NameSpeakerRequest.safeParse({ speaker_tag: 2, display_name: '田中' }).success).toBe(
      true,
    );
    expect(NameSpeakerRequest.safeParse({ speaker_tag: 2, display_name: '' }).success).toBe(false);
  });
});
