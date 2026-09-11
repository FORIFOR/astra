/**
 * WORK_CONTEXT_LIVE_GATE / DAILY_WORK_LIVE_GATE の固定 fixture と期待値。
 *
 * 専用のテスト identity（Google Workspace / Microsoft tenant）に**毎回同じ**受信箱・予定を投入し、
 * 無人で同期して、期待した Work Graph → Home → 「これ返して」→ 会議のループ → 次の brief になるかを機械で確かめる。
 * 人は OAuth を押さない（事前に用意した refresh token）。本人のアカウントは一切触らない。
 *
 * 件名・本文・案件名には実行ごとの nonce を入れ、前の実行の残骸や本物のメールと混ざらないようにする。
 * 期限・会議は**相対**（今日から N 日）で作る。
 *
 *   案件      ACME-<nonce>
 *   Mail A    「<dl> までに見積をください。コード <nonce>」（相手 → 自分）
 *   Meeting 1 決定「Standard プランで提案する」/ やること「見積を <dl> までに送る」（昨日）
 *   Mail B    「導入日は社内確認中です」（会議のあと）
 *   Meeting 2 1時間後の顧客定例（次の brief の対象）
 */
import type { MeetingBrief, WorkArtifact, WorkContext } from '@astra/contracts';

export interface LiveFixture {
  readonly nonce: string;
  readonly project: string;
  readonly mailA: { subject: string; body: string; from: string };
  readonly mailB: { subject: string; body: string; from: string };
  readonly meeting1: { title: string; startedAt: string; decision: string; action: string };
  readonly meeting2: { subject: string; startIso: string; endIso: string };
  readonly task: { title: string; dueIso: string };
  /** 見積の期限（Mail A の本文に書く日付）。 */
  readonly deadlineIso: string;
  readonly deadlineLabel: string;
}

const DAY = 86_400_000;

function atHour(base: Date, days: number, hour: number): Date {
  const d = new Date(base.getTime() + days * DAY);
  d.setHours(hour, 0, 0, 0);
  return d;
}

export function liveFixture(now: Date, nonce: string): LiveFixture {
  const project = `ACME-${nonce}`;
  const deadline = atHour(now, 2, 18);
  const dl = `${deadline.getMonth() + 1}/${deadline.getDate()}`;
  const meeting1 = atHour(now, -1, 15);
  // The next-brief product window is 24 hours. Tomorrow at 15:00 falls outside
  // that window for morning runs, making the fixture depend on wall-clock time.
  const meeting2 = new Date(now.getTime() + 60 * 60_000);
  const md = `${meeting2.getMonth() + 1}/${meeting2.getDate()}`;
  return {
    nonce,
    project,
    mailA: {
      subject: `[${project}] 見積のご依頼`,
      body: `${project} の件、${dl} までに見積をください。コード ${nonce}。ご確認をお願いします。`,
      from: 'client@example.invalid',
    },
    mailB: {
      subject: `[${project}] 導入日について`,
      body: `${project} の導入日は社内確認中です。ACME担当者からの導入日確定の回答を待っています。決まり次第ご連絡します。`,
      from: 'client@example.invalid',
    },
    meeting1: {
      title: `${project} 顧客定例`,
      startedAt: meeting1.toISOString(),
      decision: 'Standard プランで提案する',
      action: `見積を ${dl} までに送る`,
    },
    meeting2: {
      subject: `${project} 顧客定例 (${md})`,
      startIso: meeting2.toISOString(),
      endIso: new Date(meeting2.getTime() + 3_600_000).toISOString(),
    },
    task: { title: `${project} 提案資料を完成`, dueIso: deadline.toISOString() },
    deadlineIso: deadline.toISOString(),
    deadlineLabel: dl,
  };
}

/**
 * Meeting 1 の結論を、実の finalize と同じ形（安定 id、origin、出所）で作る。
 * 実の経路（meeting.bundle → sink）は meeting の試験が見る。ここは音声の代わりに bundle を与える。
 */
export function syntheticMeetingArtifacts(f: LiveFixture, observedAt: string): WorkArtifact[] {
  const meetingId = `live-${f.nonce}`;
  const base = Date.parse(f.meeting1.startedAt);
  const make = (
    kind: 'decision' | 'action',
    text: string,
    segment: string,
    startMs: number,
    due: string | null,
  ): WorkArtifact => ({
    id: `meeting:${meetingId}:${kind}:${segment}`,
    source: 'meeting',
    kind: kind === 'decision' ? 'decision' : 'action_item',
    title: text,
    body_excerpt: null,
    people:
      kind === 'action'
        ? [{ name: '自分', email: null, role: 'assignee' }]
        : [{ name: '先方', email: null, role: 'mentioned' }],
    direction: 'self',
    occurred_at: new Date(base + startMs).toISOString(),
    ends_at: null,
    due_at: due,
    thread_id: null,
    project_hint: f.project,
    responded: null,
    completed: kind === 'action' ? false : null,
    provenance: {
      source: 'meeting',
      external_id: meetingId,
      label: f.meeting1.title,
      observed_at: observedAt,
      url: null,
      excerpt: `${kind === 'action' ? '自分' : '先方'}: ${text}`,
    },
    semantic: {
      category: kind === 'action' ? 'request_to_me' : 'info',
      project: f.project,
      request: text,
      owner: kind === 'action' ? '自分' : null,
      waiting_on: null,
      due,
      confidence: 0.8,
      extracted_by: 'llm',
    },
    origin: {
      meeting_id: meetingId,
      segment_id: segment,
      speaker: kind === 'action' ? '自分' : '先方',
      start_ms: startMs,
      transcript_artifact_id: null,
      audio_artifact_id: null,
      status: 'inferred',
    },
  });
  const anchor: WorkArtifact = {
    id: `meeting:${meetingId}`,
    source: 'meeting',
    kind: 'meeting',
    title: f.meeting1.title,
    body_excerpt: null,
    people: [],
    direction: 'self',
    occurred_at: f.meeting1.startedAt,
    ends_at: new Date(base + 3_600_000).toISOString(),
    due_at: null,
    thread_id: null,
    project_hint: f.project,
    responded: null,
    completed: null,
    provenance: {
      source: 'meeting',
      external_id: meetingId,
      label: f.meeting1.title,
      observed_at: observedAt,
      url: null,
      excerpt: null,
    },
    semantic: null,
    origin: null,
  };
  return [
    anchor,
    make('decision', f.meeting1.decision, 'seg-1', 600_000, null),
    make('action', f.meeting1.action, 'seg-2', 620_000, f.deadlineIso),
  ];
}

export interface LiveExpectationRow {
  readonly group: string;
  readonly row: string;
  readonly ok: boolean;
  readonly detail: string;
}

/** Home（Work Context）の期待。**主観は無い。**すべて機械で読める条件。 */
export function checkHome(context: WorkContext, f: LiveFixture, now: Date): LiveExpectationRow[] {
  const rows: LiveExpectationRow[] = [];
  const priority = context.priorities.find((p) => p.project.includes(f.nonce)) ?? null;
  rows.push({
    group: 'Home',
    row: 'project nonce found',
    ok: priority !== null,
    detail: priority?.project ?? `no priority mentions ${f.nonce}`,
  });
  const matchingDue = context.priorities.find((item) => {
    const dueAt = item.due_at ? Date.parse(item.due_at) : NaN;
    return Number.isFinite(dueAt) && Math.abs(dueAt - Date.parse(f.deadlineIso)) < 36 * 3_600_000;
  });
  const due = matchingDue?.due_at ? Date.parse(matchingDue.due_at) : NaN;
  rows.push({
    group: 'Home',
    row: 'deadline found',
    ok: Number.isFinite(due),
    detail: matchingDue?.due_at ?? 'none',
  });
  rows.push({
    group: 'Home',
    row: 'pressure HIGH',
    ok: (priority?.score ?? 0) >= 0.5,
    detail: priority ? `${priority.score.toFixed(2)} (>= 0.50)` : 'none',
  });
  const sources = priority?.sources ?? [];
  rows.push({
    group: 'Home',
    row: 'provenance',
    ok: sources.length > 0 && sources.every((s) => (s.excerpt ?? '').length <= 200),
    detail: `${String(sources.length)} sources`,
  });
  rows.push({
    group: 'Home',
    row: 'generated recently',
    ok: Math.abs(Date.parse(context.generated_at) - now.getTime()) < 10 * 60_000,
    detail: context.generated_at,
  });
  return rows;
}

/** 「これ返して」の期待: 正しいスレッド、ACME の文脈だけ、別案件 0。 */
export function checkReply(
  input: {
    target: { subject: string; thread_id: string | null } | null;
    context: string | null;
    draft: string | null;
    sinkHit: boolean | null;
  },
  f: LiveFixture,
): LiveExpectationRow[] {
  const rows: LiveExpectationRow[] = [];
  rows.push({
    group: 'Reply',
    row: 'correct thread',
    ok: input.target?.subject.includes(f.nonce) === true,
    detail: input.target?.subject ?? 'unresolved',
  });
  const ctx = input.context ?? '';
  rows.push({
    group: 'Reply',
    row: 'draft context only ACME',
    ok: ctx.includes(f.project),
    detail: `${String(ctx.length)} chars`,
  });
  rows.push({
    group: 'Reply',
    row: 'no other-project context',
    ok: !/MOPITA|○○社|社内報/.test(ctx),
    detail: 'other project names absent',
  });
  rows.push({
    group: 'Reply',
    row: 'draft produced',
    ok: (input.draft ?? '').trim().length > 0,
    detail: `${String((input.draft ?? '').length)} chars`,
  });
  rows.push({
    group: 'Reply',
    row: 'test sink receives nonce',
    ok: input.sinkHit === true,
    detail: input.sinkHit === null ? 'not checked' : String(input.sinkHit),
  });
  return rows;
}

/** 会議ループと次の brief の期待。 */
export function checkBrief(brief: MeetingBrief | null, f: LiveFixture): LiveExpectationRow[] {
  const rows: LiveExpectationRow[] = [];
  if (!brief) {
    rows.push({ group: 'Next brief', row: 'brief available', ok: false, detail: 'no brief' });
    return rows;
  }
  rows.push({
    group: 'Next brief',
    row: 'event is meeting 2',
    ok: brief.title.includes(f.nonce),
    detail: brief.title,
  });
  rows.push({
    group: 'Meeting loop',
    row: 'previous decision found',
    ok: brief.previous.some((p) => p.text.includes(f.meeting1.decision)),
    detail: brief.previous.map((p) => p.text).join(' / ') || 'none',
  });
  rows.push({
    group: 'Meeting loop',
    row: 'open action found',
    ok: brief.previous.some((p) => p.text.includes('やること') && p.text.includes('見積')),
    detail: 'previous includes やること',
  });
  rows.push({
    group: 'Next brief',
    row: 'mail since last meeting found',
    ok: brief.since_last_meeting.length > 0,
    detail: brief.since_last_meeting.map((s) => s.text).join(' / ') || 'none',
  });
  const facts = [...brief.previous, ...brief.since_last_meeting, ...brief.open_items];
  rows.push({
    group: 'Next brief',
    row: 'provenance 100%',
    ok: facts.every((x) => x.sources.length > 0) && brief.provenance.length > 0,
    detail: `${String(facts.length)} facts`,
  });
  rows.push({
    group: 'Next brief',
    row: 'fabricated item 0',
    ok:
      brief.suggested_questions.every((q) => q.sources.length > 0 && q.reason.length > 0) &&
      brief.suggested_questions.length <= 3,
    detail: `${String(brief.suggested_questions.length)} questions, all sourced`,
  });
  rows.push({
    group: 'Next brief',
    row: 'no other-project contamination',
    ok: !/MOPITA|○○社/.test(JSON.stringify(brief)),
    detail: 'other project names absent',
  });
  return rows;
}
