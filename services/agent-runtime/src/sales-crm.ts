/**
 * Sales CRM の最初の専業 Agent。正本 §15.3、Phase 5 実装仕様 §4。
 *
 * 外部 CRM に繋がなくても成立する部分だけを作る。
 * `meeting prep` / `call notes to CRM` / `follow-up drafts` は
 * Gmail / Calendar / Salesforce の接続先が決まってから（OQ-20）。
 */
import type { DomainEntity, EntityDef } from '@astra/contracts';

/** 正本 §15.3 の entity。**plugin が持ち込む形をそのまま書いてある。** */
export const SALES_CRM_ENTITIES: Record<string, EntityDef> = {
  account: {
    id: 'account',
    title: '取引先',
    title_field: 'name',
    fields: [
      { id: 'name', type: 'text', required: true },
      { id: 'industry', type: 'text', required: false },
    ],
  },
  contact: {
    id: 'contact',
    title: '担当者',
    title_field: 'name',
    fields: [
      { id: 'name', type: 'text', required: true },
      { id: 'email', type: 'text', required: false },
      { id: 'account', type: 'reference', entity: 'account', required: false },
    ],
  },
  opportunity: {
    id: 'opportunity',
    title: '商談',
    title_field: 'name',
    fields: [
      { id: 'name', type: 'text', required: true },
      { id: 'amount', type: 'number', required: false },
      {
        id: 'stage',
        type: 'enum',
        values: ['lead', 'qualified', 'proposal', 'won', 'lost'],
        required: true,
      },
      { id: 'close_date', type: 'date', required: false },
      { id: 'account', type: 'reference', entity: 'account', required: false },
    ],
  },
  activity: {
    id: 'activity',
    title: '活動',
    title_field: 'summary',
    fields: [
      { id: 'summary', type: 'text', required: true },
      { id: 'occurred_at', type: 'date', required: true },
      { id: 'kind', type: 'enum', values: ['call', 'meeting', 'email', 'note'], required: true },
    ],
  },
  next_action: {
    id: 'next_action',
    title: '次の一手',
    title_field: 'what',
    fields: [
      { id: 'what', type: 'text', required: true },
      { id: 'due', type: 'date', required: false },
      { id: 'why', type: 'text', required: true },
    ],
  },
};

/** 決着した stage。pipeline には数えるが「残っている」ではない。 */
const CLOSED = new Set(['won', 'lost']);

export interface PipelineStage {
  readonly stage: string;
  readonly count: number;
  readonly total: number;
  readonly open: boolean;
}

/**
 * stage ごとの件数と金額。正本 §15.3 pipeline analysis。
 *
 * **stage の並びは定義の順**にする。金額順に並べると、
 * 見るたびに段の位置が変わって読めない。
 */
export function pipelineSummary(opportunities: readonly DomainEntity[]): PipelineStage[] {
  const stages = (SALES_CRM_ENTITIES['opportunity']!.fields.find((f) => f.id === 'stage')?.values ??
    []) as readonly string[];

  const buckets = new Map<string, { count: number; total: number }>();
  for (const stage of stages) buckets.set(stage, { count: 0, total: 0 });

  for (const opportunity of opportunities) {
    const stage = String(opportunity.fields['stage'] ?? '');
    const bucket = buckets.get(stage);
    // 定義に無い stage は数えない。混ぜると合計が意味を持たなくなる。
    if (!bucket) continue;
    bucket.count += 1;
    const amount = opportunity.fields['amount'];
    if (typeof amount === 'number') bucket.total += amount;
  }

  return stages.map((stage) => ({
    stage,
    count: buckets.get(stage)!.count,
    total: buckets.get(stage)!.total,
    open: !CLOSED.has(stage),
  }));
}

export interface NextBestAction {
  readonly opportunityId: string;
  readonly opportunityName: string;
  readonly what: string;
  readonly why: string;
  /** 根拠になった活動。**無いものは出さない**（AC5-9）。 */
  readonly evidence: readonly { id: string; summary: string; occurredAt: string }[];
}

export interface OpportunityWithActivity {
  readonly opportunity: DomainEntity;
  readonly activities: readonly DomainEntity[];
}

/**
 * 次の一手。
 *
 * **根拠のない提案を出さない。**「そろそろ連絡した方がよい」と言うなら、
 * 最後の活動がいつだったかを添える。添えられないものは出さない。
 *
 * 何を勧めるかの賢さはモデルの仕事。ここが持つのは
 * 「根拠を落とさない」という、モデルに任せてはいけない性質。
 */
export function nextBestActions(
  items: readonly OpportunityWithActivity[],
  options: { readonly staleAfterDays?: number; readonly now?: Date } = {},
): NextBestAction[] {
  const staleAfterDays = options.staleAfterDays ?? 14;
  const now = options.now ?? new Date();
  const out: NextBestAction[] = [];

  for (const { opportunity, activities } of items) {
    const stage = String(opportunity.fields['stage'] ?? '');
    // 決着した商談に次の一手は無い
    if (CLOSED.has(stage)) continue;

    const dated = [...activities]
      .map((a) => ({ entity: a, at: Date.parse(String(a.fields['occurred_at'] ?? '')) }))
      .filter((a) => Number.isFinite(a.at))
      .sort((a, b) => b.at - a.at);

    if (dated.length === 0) {
      // 活動が 1 つも無い。**それ自体が根拠になる**ので、そう書く。
      out.push({
        opportunityId: opportunity.id,
        opportunityName: opportunity.title,
        what: '最初の接触を記録する',
        why: 'この商談にはまだ活動が 1 件も残っていません',
        evidence: [],
      });
      continue;
    }

    const last = dated[0]!;
    const days = Math.floor((now.getTime() - last.at) / 86_400_000);
    if (days < staleAfterDays) continue;

    out.push({
      opportunityId: opportunity.id,
      opportunityName: opportunity.title,
      what: '次の連絡を入れる',
      why: `最後の活動から ${days} 日空いています`,
      evidence: dated.slice(0, 3).map((a) => ({
        id: a.entity.id,
        summary: String(a.entity.fields['summary'] ?? a.entity.title),
        occurredAt: String(a.entity.fields['occurred_at'] ?? ''),
      })),
    });
  }

  // 放置が長い順。同じなら名前順で安定させる。
  return out.sort(
    (a, b) => staleDays(b) - staleDays(a) || a.opportunityName.localeCompare(b.opportunityName),
  );
}

function staleDays(action: NextBestAction): number {
  const match = /(\d+) 日/.exec(action.why);
  return match ? Number(match[1]) : Number.MAX_SAFE_INTEGER;
}
