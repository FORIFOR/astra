/**
 * Care Support Agent。正本 §15.4。
 *
 * §15.4 は「REGULATED policy required」と言っている。
 * つまり、ここで作ってよいのは**下書きと要約と見落としの指摘**までで、
 * **ケアの判断は人がする。**
 *
 * この線を守るために、実装側で決めてあること:
 *
 *   - 記録に無いことは書かない（`handoff` は入力の記録だけから作る）
 *   - 埋まっていない欄は空欄のまま残す（`incidentDraft`）
 *   - 良し悪しを判断しない（数値と観察をそのまま並べる）
 */
import type { DomainEntity } from '@astra/contracts';

export interface ShiftNote {
  readonly id: string;
  readonly residentId: string | null;
  readonly residentName: string;
  readonly shift: string;
  readonly recordedAt: string | null;
  readonly summary: string;
  readonly observation: string | null;
  /** 前回から変化があったか。記録されていなければ null（**false にしない**）。 */
  readonly changed: boolean | null;
}

function text(entity: DomainEntity, field: string): string | null {
  const value = entity.fields[field];
  return typeof value === 'string' && value.length > 0 ? value : null;
}

export function toShiftNote(entity: DomainEntity, residentName: string): ShiftNote {
  const changed = entity.fields['changed'];
  return {
    id: entity.id,
    residentId: text(entity, 'resident'),
    residentName,
    shift: text(entity, 'shift') ?? '不明',
    recordedAt: text(entity, 'recorded_at'),
    summary: text(entity, 'summary') ?? '',
    observation: text(entity, 'observation'),
    // 記録が無いことを「変化なし」にしない
    changed: typeof changed === 'boolean' ? changed : null,
  };
}

/**
 * 申し送り。
 *
 * **その勤務帯に実際に記録されたことだけ**から作る。
 * 変化のあったものを先に置き、変化が無ければ「変化なし」と書く。
 * **記録が無いことは「変化なし」ではない。**
 */
export function handoffSummary(notes: readonly ShiftNote[]): string {
  if (notes.length === 0) {
    // 何も無いことを、何も無いと書く。埋めない。
    return 'この勤務帯の記録はありません。';
  }

  const byResident = new Map<string, ShiftNote[]>();
  for (const note of notes) {
    byResident.set(note.residentName, [...(byResident.get(note.residentName) ?? []), note]);
  }

  const blocks = [...byResident.entries()]
    // 変化のあった方を先に。名前で並べると、見落としが後ろに沈む。
    .sort(
      ([, a], [, b]) => rank(b) - rank(a) || a[0]!.residentName.localeCompare(b[0]!.residentName),
    )
    .map(([name, theirs]) => {
      const lines = theirs.map((note) => {
        const parts = [note.summary];
        if (note.observation) parts.push(note.observation);
        return `  - ${parts.join(' / ')}`;
      });
      const mark =
        rank(theirs) === 2 ? '【変化あり】' : rank(theirs) === 1 ? '【記録なしの項目あり】' : '';
      return `- ${name} ${mark}`.trimEnd() + '\n' + lines.join('\n');
    });

  return ['# 申し送り', '', ...blocks].join('\n');
}

/** 2: 変化あり / 1: 変化が記録されていない / 0: 変化なし */
function rank(notes: readonly ShiftNote[]): number {
  if (notes.some((n) => n.changed === true)) return 2;
  if (notes.some((n) => n.changed === null)) return 1;
  return 0;
}

/** 5W1H。**埋まっていない欄は空欄のまま残す。** */
export const INCIDENT_FIELDS = [
  { id: 'occurred_at', label: 'いつ' },
  { id: 'where', label: 'どこで' },
  { id: 'who_found', label: '誰が見つけたか' },
  { id: 'what_happened', label: '何が起きたか' },
  { id: 'response', label: 'どう対応したか' },
] as const;

export interface IncidentDraft {
  readonly markdown: string;
  /** 埋まっていない欄。**提出前に人が埋める。** */
  readonly missing: readonly string[];
}

/**
 * 事故・ヒヤリハットの下書き。
 *
 * **それらしい値で埋めない。**分からない時刻や人を埋めると、
 * 記録として使えなくなる。埋まっていない欄は空欄で残し、
 * 何が足りないかを添える。
 */
export function incidentDraft(entity: DomainEntity, residentName: string): IncidentDraft {
  const missing: string[] = [];
  const rows = INCIDENT_FIELDS.map((field) => {
    const value = text(entity, field.id);
    if (value === null) missing.push(field.label);
    return `| ${field.label} | ${value ?? ''} |`;
  });

  const markdown = [
    `# ${text(entity, 'title') ?? '記録'}`,
    '',
    `対象: ${residentName}`,
    '',
    '| 項目 | 内容 |',
    '| --- | --- |',
    ...rows,
    '',
    missing.length > 0
      ? `未記入: ${missing.join('・')}。**提出する前に埋めてください。**`
      : 'すべて記入されています。内容を確かめてから提出してください。',
  ].join('\n');

  return { markdown, missing };
}

export interface PlanReview {
  readonly title: string;
  readonly residentName: string;
  readonly dueAt: string | null;
  /** 期日までの日数。期日が無ければ null。 */
  readonly daysLeft: number | null;
}

const DAY_MS = 86_400_000;

/**
 * 見直しの時期が来たケアプラン。
 *
 * **期日の無いものを「まだ先」にしない。**期日が入っていないことは、
 * それ自体が知らせるべきこと。
 */
export function reviewsDue(
  plans: readonly { title: string; residentName: string; reviewDue: string | null }[],
  now: Date,
  withinDays = 30,
): PlanReview[] {
  return (
    plans
      .map((plan) => {
        const at = plan.reviewDue ? Date.parse(plan.reviewDue) : Number.NaN;
        const daysLeft = Number.isFinite(at) ? Math.floor((at - now.getTime()) / DAY_MS) : null;
        return {
          title: plan.title,
          residentName: plan.residentName,
          dueAt: plan.reviewDue,
          daysLeft,
        };
      })
      .filter((plan) => plan.daysLeft === null || plan.daysLeft <= withinDays)
      // 過ぎているものが先。期日不明はその次（見落としやすいので上に置く）。
      .sort((a, b) => (a.daysLeft ?? -0.5) - (b.daysLeft ?? -0.5))
  );
}
