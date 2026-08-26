/**
 * World Model。正本 §10、Phase 6 実装仕様 §2・§3。
 *
 * 会話ログではなく「ユーザーの世界の現在状態」を持つ。
 *
 * 要点は 2 つ:
 *   - **全部は覚えない**（正本 §10.3）。書いてよいものを型で絞る
 *   - **出所の無い fact は作らない**（D-43）。辿れないものは信用の根拠にならない
 */
import { z } from 'zod';
import { ArtifactId, MeetingId, TaskId, TenantId } from './ids.js';
import { Timestamp } from './primitives.js';

/** 正本 §10.1 の entity 種別。 */
export const WORLD_ENTITY_KINDS = [
  'person',
  'organization',
  'project',
  'conversation',
  'meeting',
  'task',
  'commitment',
  'decision',
  'artifact',
  'research_run',
  'evidence',
  'event',
  'preference',
  'domain_entity',
] as const;
export const WorldEntityKind = z.enum(WORLD_ENTITY_KINDS);
export type WorldEntityKind = z.infer<typeof WorldEntityKind>;

/** 正本 §10.1 の関係。ここに無い関係は張らない。 */
export const WORLD_RELATIONS = [
  'belongs_to',
  'works_with',
  'mentioned_in',
  'decided_in',
  'produced_by',
  'assigned_to',
  'depends_on',
  'related_to',
] as const;
export const WorldRelation = z.enum(WORLD_RELATIONS);
export type WorldRelation = z.infer<typeof WorldRelation>;

export const WorldEntity = z.object({
  id: z.uuid(),
  tenant_id: TenantId,
  kind: WorldEntityKind,
  /** 表示名。 */
  name: z.string().min(1).max(200),
  /** 寄せるための正規化名。同じ人を二度作らないための鍵（D-45）。 */
  normalized_name: z.string().min(1),
  /** 何度出てきたか。「よく出てくる人・案件」の判定に使う（正本 §10.3）。 */
  mention_count: z.number().int().nonnegative(),
  attributes: z.record(z.string(), z.unknown()),
  first_seen_at: Timestamp,
  last_seen_at: Timestamp,
});
export type WorldEntity = z.infer<typeof WorldEntity>;

// ------------------------------------------------------------------- fact

/**
 * 正本 §10.3 の保存候補。**これ以外は書かない。**
 * 「後で役に立つかもしれない」で溜めると、検索の精度が落ち、
 * 消す責任だけが残る。
 */
export const MEMORABLE_KINDS = [
  'preference',
  'commitment',
  'decision',
  'artifact_lineage',
  'task_status',
  'correction',
] as const;
export const FactKind = z.enum(MEMORABLE_KINDS);
export type FactKind = z.infer<typeof FactKind>;

/**
 * どこで生まれたか。**必ず 1 つは要る**（D-43）。
 * 会議の引用（Phase 3 §5）と同じで、辿れることが信用を作る。
 */
export const FactSource = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('meeting'), meeting_id: MeetingId, segment_id: z.uuid() }),
  z.object({ kind: z.literal('task'), task_id: TaskId }),
  z.object({ kind: z.literal('artifact'), artifact_id: ArtifactId }),
  /** 利用者が自分で言った。これも出所として扱う。 */
  z.object({ kind: z.literal('user'), stated_at: Timestamp }),
]);
export type FactSource = z.infer<typeof FactSource>;

export const CommitmentStatus = z.enum(['OPEN', 'DONE', 'DROPPED']);
export type CommitmentStatus = z.infer<typeof CommitmentStatus>;

export const WorldFact = z.object({
  id: z.uuid(),
  tenant_id: TenantId,
  kind: FactKind,
  /** 何を覚えているか。人が読める 1 文。 */
  statement: z.string().min(1).max(1_000),
  /** 誰・何についてか。分からなければ null。**埋めない。** */
  subject_entity_id: z.uuid().nullable(),
  source: FactSource,
  /** commitment だけが使う。 */
  status: CommitmentStatus.nullable(),
  due_at: Timestamp.nullable(),
  /** どれくらい確かか。抽出のしかたで変わる。 */
  confidence: z.number().min(0).max(1),
  created_at: Timestamp,
  updated_at: Timestamp,
});
export type WorldFact = z.infer<typeof WorldFact>;

// ------------------------------------------------------------- attention

/** UI/UX §16 の severity。出す面が違う。 */
export const SEVERITIES = ['info', 'attention', 'action-required', 'critical'] as const;
export const Severity = z.enum(SEVERITIES);
export type Severity = z.infer<typeof Severity>;

/**
 * 出す面。UI/UX §16 の表そのもの。
 *
 * | Severity        | Surface                              |
 * | Info            | Home only                            |
 * | Attention       | Home + subtle badge                  |
 * | Action required | OS notification + Work Waiting       |
 * | Critical        | OS alert only when policy requires   |
 *
 * **severity を持っているだけでは面は分かれない。**
 * ここを通さずに score だけで割り込むと、
 * 「調査が終わりました」で OS 通知が鳴る。§16 はそれを禁じている。
 */
export const NOTIFICATION_SURFACES = [
  'home',
  'badge',
  'work_waiting',
  'os_notification',
  'os_alert',
] as const;
export const NotificationSurface = z.enum(NOTIFICATION_SURFACES);
export type NotificationSurface = z.infer<typeof NotificationSurface>;

const SURFACES: Readonly<Record<Severity, readonly NotificationSurface[]>> = {
  // Home only。**割り込まない。**
  info: ['home'],
  // Home + 控えめな印。まだ割り込まない。
  attention: ['home', 'badge'],
  // ここで初めて OS へ出す。Work の「確認待ち」にも並ぶ。
  'action-required': ['home', 'work_waiting', 'os_notification'],
  // policy が要求するときだけの警告。
  critical: ['home', 'os_alert'],
};

export function surfacesFor(severity: Severity): readonly NotificationSurface[] {
  return SURFACES[severity];
}

/** OS まで割り込むか。**info と attention は決して割り込まない。** */
export function interrupts(severity: Severity): boolean {
  return surfacesFor(severity).some((s) => s === 'os_notification' || s === 'os_alert');
}

/**
 * 静けさより優先するか。
 *
 * critical は「録音に失敗した」「規制対象の書き込みを止めた」のような、
 * **黙っていると取り返しがつかない**もの。静かな時間帯でも出す。
 * それ以外は、静けさのほうを優先する。
 */
export function overridesQuietHours(severity: Severity): boolean {
  return severity === 'critical';
}

/**
 * Home に出す 1 件。**根拠を必ず持つ**（AC6-9）。
 * 「気にしたほうがよい」とだけ言われても、何を見ればよいか分からない。
 */
export const BriefItem = z.object({
  id: z.string(),
  severity: Severity,
  title: z.string().min(1),
  detail: z.string().nullable(),
  /** 主ボタンの文言。何をするかを書く。 */
  action_label: z.string().min(1),
  /** 押した先。 */
  target: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('task'), task_id: TaskId }),
    z.object({ kind: z.literal('meeting'), meeting_id: MeetingId }),
    z.object({ kind: z.literal('artifact'), artifact_id: ArtifactId }),
    z.object({ kind: z.literal('commitment'), fact_id: z.uuid() }),
  ]),
  score: z.number(),
});
export type BriefItem = z.infer<typeof BriefItem>;

/** UI/UX §8.1: Attention は最大 3 件。4 件目以降は「すべて見る」。 */
export const MAX_ATTENTION_ITEMS = 3;

export const DailyBrief = z.object({
  /** 上位 3 件。 */
  attention: z.array(BriefItem).max(MAX_ATTENTION_ITEMS),
  /** 残り。「すべて見る」で開く。 */
  more: z.array(BriefItem),
  generated_at: Timestamp,
});
export type DailyBrief = z.infer<typeof DailyBrief>;

// ------------------------------------------------------------------ score

export interface ProactiveSignals {
  readonly importance: number;
  readonly urgency: number;
  readonly confidence: number;
  readonly relevance: number;
  /** 割り込みの重さ。**静かにしておく価値**をここで表す。 */
  readonly interruptionCost: number;
}

/**
 * 正本 §2.1:
 *
 *   ProactiveScore = Importance × Urgency × Confidence × UserRelevance - InterruptionCost
 *
 * `interruptionCost` を引くのが要点。これが無いと、式は
 * 「出せるものは全部出す」に退化する。
 */
export function proactiveScore(signals: ProactiveSignals): number {
  return (
    signals.importance * signals.urgency * signals.confidence * signals.relevance -
    signals.interruptionCost
  );
}

/** 名前を寄せるための正規化。大文字小文字・空白・敬称を落とす（D-45）。 */
export function normalizeName(name: string): string {
  return name
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s　]+/g, '')
    .replace(/(さん|様|氏|くん|ちゃん|部長|課長|社長)$/u, '')
    .replace(/(株式会社|有限会社|\(株\)|㈱)/gu, '');
}
