/**
 * WORK_CONTEXT_LIVE_GATE の固定 fixture と期待値。
 *
 * 専用のテスト identity（Google Workspace / Microsoft tenant）に**毎回同じ**受信箱・予定・タスクを
 * 投入し、無人で同期して、期待した Work Graph になるかを機械で確かめる。人は OAuth を押さない
 * （事前に用意した refresh token を使う）。本人のアカウントは一切触らない。
 *
 * 件名には実行ごとの nonce を入れ、前の実行の残骸や本物のメールと混ざらないようにする。
 * 期限・会議は**相対**（今日から N 日）で作る。撮る日に依らない。
 */
import type { WorkContext, WorkPriority } from '@astra/contracts';

export interface LiveFixture {
  readonly nonce: string;
  readonly project: string;
  readonly mailA: { subject: string; body: string; from: string };
  readonly mailB: { subject: string; body: string; from: string };
  readonly meeting: { subject: string; startIso: string; endIso: string };
  readonly task: { title: string; dueIso: string };
  /** 見積の期限（Mail A の本文に書く日付）。 */
  readonly deadlineIso: string;
}

const DAY = 86_400_000;

function atHour(base: Date, days: number, hour: number): Date {
  const d = new Date(base.getTime() + days * DAY);
  d.setHours(hour, 0, 0, 0);
  return d;
}

export function liveFixture(now: Date, nonce: string): LiveFixture {
  const project = `Example Client ${nonce}`;
  const deadline = atHour(now, 2, 18);
  const meetingStart = atHour(now, 1, 15);
  const md = `${meetingStart.getMonth() + 1}/${meetingStart.getDate()}`;
  const dl = `${deadline.getMonth() + 1}/${deadline.getDate()}`;
  return {
    nonce,
    project,
    mailA: {
      subject: `[${project}] 見積のご依頼`,
      body: `${project} の件、${dl} までに見積をください。ご確認をお願いします。`,
      from: 'client@example.invalid',
    },
    mailB: {
      subject: `[${project}] 先日の件`,
      body: `${project} の先日の件、返信をお願いします。`,
      from: 'client@example.invalid',
    },
    meeting: {
      subject: `${project} 顧客定例 (${md} 15:00)`,
      startIso: meetingStart.toISOString(),
      endIso: new Date(meetingStart.getTime() + 3_600_000).toISOString(),
    },
    task: { title: `${project} 提案資料を完成`, dueIso: deadline.toISOString() },
    deadlineIso: deadline.toISOString(),
  };
}

export interface LiveExpectationRow {
  readonly row: string;
  readonly ok: boolean;
  readonly detail: string;
}

/** 同期後の Work Context が期待した形か。**主観は無い。**すべて機械で読める条件。 */
export function checkLiveExpectations(
  context: WorkContext,
  fixture: LiveFixture,
  now: Date,
): LiveExpectationRow[] {
  const rows: LiveExpectationRow[] = [];
  const mine = (p: WorkPriority): boolean => p.project.includes(fixture.nonce);
  const priority = context.priorities.find(mine) ?? null;
  rows.push({
    row: 'project',
    ok: priority !== null,
    detail: priority ? priority.project : `no priority mentions ${fixture.nonce}`,
  });
  const due = priority?.due_at ? new Date(priority.due_at) : null;
  const expectedDue = new Date(fixture.deadlineIso);
  rows.push({
    row: 'deadline',
    ok: due !== null && Math.abs(due.getTime() - expectedDue.getTime()) < 36 * 3_600_000,
    detail: due ? due.toISOString() : 'none',
  });
  const waiting = context.owed.filter((o) => o.project?.includes(fixture.nonce));
  rows.push({
    row: 'self_waiting',
    ok: waiting.some((o) => /見積|返信/.test(o.what)),
    detail: waiting.map((o) => o.what).join(' / ') || 'none',
  });
  const meetingLine = priority?.lines.find((l) => /(定例|会議|meeting)/.test(l)) ?? null;
  rows.push({
    row: 'meeting',
    ok: meetingLine !== null,
    detail: meetingLine ?? 'no meeting line',
  });
  rows.push({
    row: 'pressure',
    ok: (priority?.score ?? 0) >= 0.5,
    detail: priority ? `${priority.score.toFixed(2)} (>= 0.50 = HIGH)` : 'none',
  });
  const sources = priority?.sources ?? [];
  rows.push({
    row: 'provenance',
    ok: sources.length > 0 && sources.every((s) => (s.excerpt ?? '').length <= 200),
    detail: `${String(sources.length)} sources, excerpts <= 200`,
  });
  rows.push({
    row: 'generated_recently',
    ok: Math.abs(new Date(context.generated_at).getTime() - now.getTime()) < 10 * 60_000,
    detail: context.generated_at,
  });
  return rows;
}
