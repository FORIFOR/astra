/**
 * REPLY_IN_CONTEXT_GATE と MEETING_BRIEF_GATE の純粋部分。
 *
 * 見るのは:
 *   - 「これ」は候補の順で決まり、曖昧なら似たメールを選ばない（wrong-thread 0）
 *   - 返信案に添えるのは そのスレッド・その案件・直近の会議・開いている件 だけ（別案件 0）
 *   - brief は 次の予定 → 案件 → 前回 → その後 → 開いている件 で、文はすべて出所を持つ
 *   - 確かめたいことは開いている件から作り、理由と出所を持つ（作らない）
 */
import { describe, expect, it } from 'vitest';
import type { WorkArtifact, WorkSemantic } from '@astra/contracts';
import {
  buildMeetingBrief,
  buildReplyPack,
  buildWorkContext,
  renderReplyContext,
  resolveReplyTarget,
} from '../src/index.js';

const NOW = new Date('2026-09-07T09:00:00+09:00');
const iso = (d: string): string => new Date(d).toISOString();

function art(over: Partial<WorkArtifact> & { id: string; title: string }): WorkArtifact {
  return {
    source: 'gmail',
    kind: 'email',
    body_excerpt: null,
    people: [],
    direction: 'inbound',
    occurred_at: iso('2026-09-06T14:21:00+09:00'),
    ends_at: null,
    due_at: null,
    thread_id: null,
    project_hint: null,
    responded: null,
    completed: null,
    provenance: {
      source: over.source ?? 'gmail',
      external_id: over.id,
      label: over.title,
      observed_at: iso('2026-09-06T14:21:00+09:00'),
      url: null,
      excerpt: over.body_excerpt ?? null,
    },
    semantic: null,
    ...over,
  };
}
const sem = (over: Partial<WorkSemantic>): WorkSemantic => ({
  category: 'info',
  project: null,
  request: null,
  owner: null,
  waiting_on: null,
  due: null,
  confidence: 0.9,
  extracted_by: 'llm',
  ...over,
});
const MTI = { name: 'MTI 田中', email: 'tanaka@mti.example', role: 'from' as const };

const fixture: WorkArtifact[] = [
  art({
    id: 'm1',
    title: 'Re: MOPITA 見積の件',
    thread_id: 'th-mopita',
    people: [MTI],
    occurred_at: iso('2026-09-06T10:00:00+09:00'),
    body_excerpt: '見積の再提出をお願いします。9/9 までに。',
    semantic: sem({
      category: 'request_to_me',
      project: 'MOPITA連携',
      request: '見積を再提出する',
      due: iso('2026-09-09T18:00:00+09:00'),
    }),
  }),
  art({
    id: 'm0',
    title: 'MOPITA 見積の件',
    thread_id: 'th-mopita',
    people: [{ ...MTI, role: 'to' }],
    direction: 'outbound',
    occurred_at: iso('2026-09-04T10:00:00+09:00'),
    body_excerpt: '見積をお送りします。',
    semantic: sem({
      category: 'request_to_other',
      project: 'MOPITA連携',
      waiting_on: 'MTI',
      request: '見積の確認をお願いする',
    }),
  }),
  // 似た件名の**別スレッド**（wrong-thread の罠）
  art({
    id: 'x1',
    title: 'Re: MOPITA 見積の件（2025 年分）',
    thread_id: 'th-old',
    people: [{ name: '佐藤', email: 'sato@example.com', role: 'from' }],
    occurred_at: iso('2026-08-01T10:00:00+09:00'),
    semantic: sem({ category: 'info', project: 'MOPITA連携' }),
  }),
  art({
    id: 'e1',
    title: '【○○社】提案書のご確認',
    thread_id: 'th-quote',
    people: [{ name: '鈴木', email: 'suzuki@example.com', role: 'from' }],
    occurred_at: iso('2026-09-05T09:30:00+09:00'),
    body_excerpt: '提案書の確認をお願いします。',
    semantic: sem({ category: 'request_to_me', project: '○○社 提案', request: '提案書に返信する' }),
  }),
  art({
    id: 'mt1',
    title: 'MOPITA 定例',
    source: 'meeting',
    kind: 'meeting',
    occurred_at: iso('2026-09-03T15:00:00+09:00'),
    project_hint: 'MOPITA連携',
    body_excerpt: '価格案を再提出することに決定',
  }),
  art({
    id: 'd1',
    title: '価格案を再提出することに決定',
    source: 'meeting',
    kind: 'decision',
    occurred_at: iso('2026-09-03T15:40:00+09:00'),
    project_hint: 'MOPITA連携',
    semantic: sem({
      category: 'info',
      project: 'MOPITA連携',
      request: '価格案を再提出することに決定',
    }),
  }),
  art({
    id: 'a1',
    title: '導入時期を先方に確認する',
    source: 'meeting',
    kind: 'action_item',
    occurred_at: iso('2026-09-03T15:45:00+09:00'),
    project_hint: 'MOPITA連携',
    semantic: sem({
      category: 'request_to_me',
      project: 'MOPITA連携',
      request: '導入時期を先方に確認する',
    }),
  }),
  art({
    id: 'c1',
    title: 'MOPITA 定例',
    source: 'google_calendar',
    kind: 'calendar_event',
    occurred_at: iso('2026-09-07T14:00:00+09:00'),
    ends_at: iso('2026-09-07T15:00:00+09:00'),
    project_hint: 'MOPITA連携',
    people: [{ name: 'MTI 田中', email: 'tanaka@mti.example', role: 'attendee' }],
  }),
];

const ctx = buildWorkContext({
  artifacts: fixture,
  corrections: [],
  now: NOW,
  inferenceEnabled: true,
});

describe('reply in context', () => {
  it('resolves 「これ」 from the open mail first, to the exact thread', () => {
    const r = resolveReplyTarget({
      utterance: 'これ返して',
      candidates: [{ kind: 'mail', label: 'Re: MOPITA 見積の件 - Gmail', app: 'Google Chrome' }],
      artifacts: fixture,
    });
    expect(r.status).toBe('resolved');
    if (r.status !== 'resolved') return;
    expect(r.target.thread_id).toBe('th-mopita');
    expect(r.target.artifact_id).toBe('m1');
    expect(r.target.matched_by).toBe('mail');
    expect(r.target.to?.name).toBe('MTI 田中');
    expect(r.target.project).toBe('MOPITA連携');
  });

  it('does not pick a similar mail from another thread when nothing is open (wrong-thread 0)', () => {
    const none = resolveReplyTarget({
      utterance: 'これ返して',
      candidates: [],
      artifacts: fixture,
    });
    expect(none.status).toBe('none');
    // 前面の窓が無関係（Xcode）なら、それも当てない
    const unrelated = resolveReplyTarget({
      utterance: 'これ返して',
      candidates: [{ kind: 'frontmost', label: 'main.swift — Astra', app: 'Xcode' }],
      artifacts: fixture,
    });
    expect(unrelated.status).toBe('none');
  });

  it('says ambiguous when two threads match equally, instead of guessing', () => {
    const two = [
      ...fixture,
      art({
        id: 'y1',
        title: 'Re: MOPITA 見積の件',
        thread_id: 'th-other',
        people: [{ name: '高橋', email: null, role: 'from' }],
        occurred_at: iso('2026-09-06T11:00:00+09:00'),
      }),
    ];
    const r = resolveReplyTarget({
      utterance: 'これ返して',
      candidates: [{ kind: 'mail', label: 'Re: MOPITA 見積の件', app: 'Mail' }],
      artifacts: two,
    });
    expect(r.status).toBe('ambiguous');
  });

  it('falls back to the named counterpart in the utterance, newest thread only', () => {
    const r = resolveReplyTarget({
      utterance: '田中さんに返信して',
      candidates: [],
      artifacts: fixture,
    });
    expect(r.status).toBe('resolved');
    if (r.status !== 'resolved') return;
    expect(r.target.matched_by).toBe('named');
    expect(r.target.artifact_id).toBe('m1');
  });

  it('packs only that thread, that project, its latest meeting and open items — nothing from other projects', () => {
    const r = resolveReplyTarget({
      utterance: 'これ返して',
      candidates: [{ kind: 'mail', label: 'Re: MOPITA 見積の件', app: 'Mail' }],
      artifacts: fixture,
    });
    if (r.status !== 'resolved') throw new Error('unresolved');
    const pack = buildReplyPack({ target: r.target, artifacts: fixture, context: ctx });
    expect(pack.thread.map((t) => t.external_id)).toEqual(['m1', 'm0']);
    expect(pack.project).toBe('MOPITA連携');
    expect(pack.meeting?.external_id).toMatch(/^(mt1|d1|a1)$/);
    expect(pack.open_items.length).toBeGreaterThan(0);
    expect(pack.sources.length).toBeGreaterThan(0);
    const text = renderReplyContext(pack);
    expect(text).toContain('MOPITA');
    expect(text).not.toContain('○○社');
    expect(text).not.toContain('提案書');
    expect(text.length).toBeLessThanOrEqual(1_800);
  });
});

describe('meeting brief', () => {
  it('resolves the next event, its project, the previous meeting, mails since, open items and questions with sources', () => {
    const brief = buildMeetingBrief({ artifacts: fixture, context: ctx, now: NOW });
    expect(brief).not.toBeNull();
    if (!brief) return;
    expect(brief.event_id).toBe('c1');
    expect(brief.project).toBe('MOPITA連携');
    expect(brief.previous.map((p) => p.text)).toEqual(
      expect.arrayContaining([
        expect.stringContaining('前回: MOPITA 定例'),
        expect.stringContaining('決定: 価格案'),
      ]),
    );
    expect(brief.since_last_meeting.length).toBeGreaterThan(0);
    expect(brief.open_items.length).toBeGreaterThan(0);
    expect(brief.suggested_questions.length).toBeGreaterThanOrEqual(1);
    expect(brief.suggested_questions.length).toBeLessThanOrEqual(3);
    for (const q of brief.suggested_questions) {
      expect(q.reason.length).toBeGreaterThan(0);
      expect(q.sources.length).toBeGreaterThan(0);
    }
    // すべての文に出所がある
    for (const f of [...brief.previous, ...brief.since_last_meeting, ...brief.open_items])
      expect(f.sources.length).toBeGreaterThan(0);
    // 別案件は混ざらない
    const all = JSON.stringify(brief);
    expect(all).not.toContain('○○社');
    expect(all).not.toContain('提案書');
  });

  it('returns nothing when no timed event is coming, and never invents a question', () => {
    const noEvent = fixture.filter((a) => a.kind !== 'calendar_event');
    expect(buildMeetingBrief({ artifacts: noEvent, context: ctx, now: NOW })).toBeNull();
    const lonely = [
      art({
        id: 'c9',
        title: '歯医者',
        source: 'google_calendar',
        kind: 'calendar_event',
        occurred_at: iso('2026-09-07T13:00:00+09:00'),
      }),
    ];
    const brief = buildMeetingBrief({
      artifacts: lonely,
      context: buildWorkContext({
        artifacts: lonely,
        corrections: [],
        now: NOW,
        inferenceEnabled: true,
      }),
      now: NOW,
    });
    expect(brief?.suggested_questions).toEqual([]);
    expect(brief?.previous).toEqual([]);
  });
});
