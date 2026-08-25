/**
 * Action risk / 承認 / 実行レシート。正本 §9、実装仕様 §3.4。
 *
 * 「勝手に成功扱いしない」「全 write action は receipt を残す」は骨格側の性質であり、
 * Phase 0 から実装する（逸脱 D-09）。
 */
import { z } from 'zod';
import { ApprovalId, ReceiptId, TaskId, TenantId, UserId } from './ids.js';
import { Sha256Hex, Timestamp } from './primitives.js';

/** 正本 §9.2。順序は「影響の大きさ」の昇順で、比較可能にしてある。 */
export const ACTION_RISKS = [
  'READ',
  'REVERSIBLE_WRITE',
  'EXTERNAL_COMMIT',
  'DESTRUCTIVE',
  'REGULATED',
  'FINANCIAL',
] as const;

export const ActionRisk = z.enum(ACTION_RISKS);
export type ActionRisk = z.infer<typeof ActionRisk>;

export const riskRank = (r: ActionRisk): number => ACTION_RISKS.indexOf(r);

export const ApprovalStatus = z.enum(['PENDING', 'APPROVED', 'REJECTED', 'EXPIRED']);
export type ApprovalStatus = z.infer<typeof ApprovalStatus>;

/**
 * 承認カードに載せる情報。
 * 正本 §9.3「内部 tool 名や JSON を見せない」— UI に出せるのはここに入っているものだけ。
 * tool_id はサーバ内部と audit のためのもので、この型には**含めない**。
 */
export const ApprovalDetail = z.object({
  label: z.string().max(64),
  value: z.string().max(2000),
});
export type ApprovalDetail = z.infer<typeof ApprovalDetail>;

/**
 * 影響範囲。UI/UX §14.1「対象件数・外部/内部・取り消し可否を表示」。
 *
 * これをサーバが持たないと、クライアントが承認カードの主ボタン文言
 * （「承認」ではなく「3件送信する」）を組み立てられない。
 */
export const ApprovalImpact = z.object({
  /** 主ボタンの文言。結果を書く。「承認」「OK」のような同意語を入れない。 */
  primary_action_label: z.string().min(1).max(40),
  /** 対象件数。件数の概念が無い操作は null。 */
  affected_count: z.number().int().nonnegative().nullable(),
  /** 影響が自テナントの外へ出るか。UI の「External send」表示に対応。 */
  scope: z.enum(['internal', 'external']),
  /** 取り消せるか。DESTRUCTIVE では recovery 情報の有無を示す。 */
  reversible: z.boolean(),
  /** 取り消し方法の説明。reversible が false なら null。 */
  recovery_note: z.string().max(200).nullable(),
});
export type ApprovalImpact = z.infer<typeof ApprovalImpact>;

export const Approval = z.object({
  id: ApprovalId,
  tenant_id: TenantId,
  task_id: TaskId,
  risk: ActionRisk,
  summary: z.string().max(200),
  details: z.array(ApprovalDetail).max(20),
  impact: ApprovalImpact,
  editable_fields: z.array(z.string()).default([]),
  status: ApprovalStatus,
  expires_at: Timestamp,
  decided_by: UserId.nullable(),
  decided_at: Timestamp.nullable(),
  created_at: Timestamp,
});
export type Approval = z.infer<typeof Approval>;

export const ApprovalDecision = z.object({
  approval_id: ApprovalId,
  decision: z.enum(['APPROVED', 'REJECTED']),
  /** editable_fields に列挙されたキーのみ許可。サーバ側で再検証する。 */
  edits: z.record(z.string(), z.string()).optional(),
  note: z.string().max(1000).optional(),
});
export type ApprovalDecision = z.infer<typeof ApprovalDecision>;

/** 正本 §9.4。append-only（DB トリガで UPDATE/DELETE を拒否する）。 */
export const ActionReceipt = z.object({
  id: ReceiptId,
  tenant_id: TenantId,
  task_id: TaskId,
  tool_id: z.string(),
  actor: z.enum(['user', 'agent', 'system']),
  inputs_hash: Sha256Hex,
  result_ref: z.string().nullable(),
  risk: ActionRisk,
  approved_by: UserId.nullable(),
  reversible_until: Timestamp.nullable(),
  executed_at: Timestamp,
});
export type ActionReceipt = z.infer<typeof ActionReceipt>;
