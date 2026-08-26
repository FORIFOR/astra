/**
 * Architecture Coordinator。正本 §15.6。
 *
 * 図面は作らない。**どの版が最新で、何が未回答か**を落とさないための道具。
 *
 * ここで気を付けていること:
 *   - 最新は**発行日で決める**。版番号の文字列比較では決めない
 *   - 同じ日に 2 版あるなら、**どちらが新しいか決めない**（両方出す）
 *   - 期限の無い質疑を「まだ先」にしない
 */
import type { DomainEntity } from '@astra/contracts';

export interface Revision {
  readonly id: string;
  readonly drawingId: string;
  readonly label: string;
  readonly issuedAt: string | null;
  readonly artifactId: string | null;
}

function text(entity: DomainEntity, field: string): string | null {
  const value = entity.fields[field];
  return typeof value === 'string' && value.length > 0 ? value : null;
}

export function toRevision(entity: DomainEntity): Revision {
  return {
    id: entity.id,
    drawingId: text(entity, 'drawing') ?? '',
    label: text(entity, 'label') ?? '無題',
    issuedAt: text(entity, 'issued_at'),
    artifactId: text(entity, 'artifact'),
  };
}

export interface LatestRevision {
  readonly drawingId: string;
  /** いちばん新しい版。同着なら複数返る。 */
  readonly revisions: readonly Revision[];
  /** 同じ日に 2 つ以上あるか。**どちらが新しいかは決めない。** */
  readonly ambiguous: boolean;
  /** 発行日の入っていない版があるか。順序が決まらないので知らせる。 */
  readonly undated: readonly Revision[];
}

/**
 * 図面ごとの最新版。
 *
 * **版番号の文字列で決めない。**「A-10」と「A-9」を並べると
 * 文字列では A-10 が先に来る。発行日で決める。
 */
export function latestRevisions(revisions: readonly Revision[]): LatestRevision[] {
  const byDrawing = new Map<string, Revision[]>();
  for (const revision of revisions) {
    byDrawing.set(revision.drawingId, [...(byDrawing.get(revision.drawingId) ?? []), revision]);
  }

  return [...byDrawing.entries()].map(([drawingId, all]) => {
    const undated = all.filter(
      (r) => r.issuedAt === null || !Number.isFinite(Date.parse(r.issuedAt)),
    );
    const dated = all.filter((r) => !undated.includes(r));

    if (dated.length === 0) {
      // 全部日付なし。**どれが最新かは言えない。**
      return { drawingId, revisions: [], ambiguous: false, undated };
    }

    const newest = Math.max(...dated.map((r) => Date.parse(r.issuedAt!)));
    const latest = dated.filter((r) => Date.parse(r.issuedAt!) === newest);
    return { drawingId, revisions: latest, ambiguous: latest.length > 1, undated };
  });
}

export interface Rfi {
  readonly id: string;
  readonly question: string;
  readonly status: string;
  readonly dueAt: string | null;
  readonly drawingId: string | null;
}

export function toRfi(entity: DomainEntity): Rfi {
  return {
    id: entity.id,
    question: text(entity, 'question') ?? '',
    status: text(entity, 'status') ?? 'DRAFT',
    dueAt: text(entity, 'due_at'),
    drawingId: text(entity, 'drawing'),
  };
}

const DAY_MS = 86_400_000;

export interface OpenRfi extends Rfi {
  /** 期限までの日数。期限が無ければ null。 */
  readonly daysLeft: number | null;
}

/**
 * 未回答の質疑。期限を過ぎたものから。
 *
 * **期限の無いものを「まだ先」にしない。**期限が入っていないこと自体が、
 * 追いかけるべきこと。
 */
export function openRfis(rfis: readonly Rfi[], now: Date): OpenRfi[] {
  return (
    rfis
      .filter((rfi) => rfi.status !== 'ANSWERED')
      .map((rfi) => {
        const at = rfi.dueAt ? Date.parse(rfi.dueAt) : Number.NaN;
        return {
          ...rfi,
          daysLeft: Number.isFinite(at) ? Math.floor((at - now.getTime()) / DAY_MS) : null,
        };
      })
      // 過ぎているものが先。期限不明はその次（見落としやすいので上に置く）。
      .sort((a, b) => (a.daysLeft ?? -0.5) - (b.daysLeft ?? -0.5))
  );
}

export interface IssueHealth {
  readonly id: string;
  readonly title: string;
  /** 担当か期限が抜けているもの。**抜けていることを黙らない。** */
  readonly missing: readonly string[];
}

export function issueGaps(issues: readonly DomainEntity[]): IssueHealth[] {
  return issues
    .filter((issue) => issue.fields['status'] !== 'CLOSED')
    .map((issue) => {
      const missing: string[] = [];
      if (text(issue, 'owner') === null) missing.push('担当');
      if (text(issue, 'due_at') === null) missing.push('期限');
      return { id: issue.id, title: text(issue, 'title') ?? '無題', missing };
    })
    .filter((issue) => issue.missing.length > 0);
}

/**
 * 質疑の下書き。**1 つの質疑には 1 つの問い。**
 *
 * まとめると、答える側がどれに答えたのか分からなくなる。
 */
export function rfiProblems(question: string): string[] {
  const problems: string[] = [];
  const trimmed = question.trim();
  if (trimmed.length === 0) problems.push('質疑の本文がありません');
  // 「？」が 2 つ以上あるなら、問いが 2 つ以上ある
  const marks = (trimmed.match(/[?？]/g) ?? []).length;
  if (marks > 1) problems.push('1 つの質疑に問いが 2 つ以上あります。分けてください');
  return problems;
}
