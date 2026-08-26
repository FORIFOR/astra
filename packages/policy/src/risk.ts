/**
 * Action risk policy。正本 §9.2 / §9.3 / §9.4 / §22、実装仕様 §3.4。
 *
 * 「この操作にユーザーの承認が要るか」を決める唯一の場所。
 * 各 Agent や tool の実装がそれぞれ判断すると、必ずどこかが緩くなる。
 */
import {
  ACTION_RISKS,
  ActionRisk,
  builtInPoliciesFor,
  evaluatePolicyDocuments,
  type ComplianceProfile,
  type ExecutionSurface,
  type PolicyDocument,
} from '@astra/contracts';

/** 書き込み（= receipt を残す対象）。正本 §9.4「全 write action は receipt」。 */
export function isWrite(risk: ActionRisk): boolean {
  return risk !== 'READ';
}

/** 外部に副作用が出るか。監査の `external_effect` と対応する。 */
export function hasExternalEffect(risk: ActionRisk): boolean {
  return (
    risk === 'EXTERNAL_COMMIT' ||
    risk === 'DESTRUCTIVE' ||
    risk === 'REGULATED' ||
    risk === 'FINANCIAL'
  );
}

/**
 * リスク単体での承認要否（基本表）。正本 §9.2 の例に対応する。
 *
 *   email search  → READ             承認なし
 *   draft create  → REVERSIBLE_WRITE 承認なし（下書きは取り消せる。ここで聞くと邪魔になる）
 *   send email    → EXTERNAL_COMMIT  承認あり
 *   delete files  → DESTRUCTIVE      承認あり
 *   modify EHR    → REGULATED        承認あり
 *   place trade   → FINANCIAL        承認あり
 */
const BASE_REQUIRES_APPROVAL: Readonly<Record<ActionRisk, boolean>> = {
  READ: false,
  REVERSIBLE_WRITE: false,
  EXTERNAL_COMMIT: true,
  DESTRUCTIVE: true,
  REGULATED: true,
  FINANCIAL: true,
};

/** 個別 compliance gate を持つ profile。正本 §22。 */
const STRICT_PROFILES: readonly ComplianceProfile[] = ['REGULATED_HEALTH', 'CARE', 'FINANCIAL'];

export interface ActionContext {
  readonly risk: ActionRisk;
  /** manifest の `requires_confirmation`。低リスクでも作者が確認を要求できる。 */
  readonly toolRequiresConfirmation?: boolean;
  readonly complianceProfile: ComplianceProfile;
  readonly surface?: ExecutionSurface;
  /** どの tool か。policy の `tool_is` 条件で使う。 */
  readonly toolId?: string;
  /**
   * plugin が持ち込んだ policy（正本 §22）。
   * profile ごとの組み込み規則は、渡されなくても効く。
   */
  readonly policies?: readonly PolicyDocument[];
}

export interface PolicyDecision {
  /** 実行そのものを止めるか。**確認すれば通る、ではない場合がある。** */
  readonly denied: boolean;
  /** 効いた規則。監査とデバッグに使う。 */
  readonly appliedRules: readonly string[];
  readonly requiresApproval: boolean;
  /** 金額・価格・注文種別の読み上げ確認。正本 §15.7。 */
  readonly requiresReadback: boolean;
  /** `action_receipts` への記録が必要か。正本 §9.4。 */
  readonly requiresReceipt: boolean;
  /** `audit_events` への記録が必要か。正本 §21 / §22。 */
  readonly requiresAudit: boolean;
  /**
   * 手元でだけ実行するか。正本 §16.1。
   *
   * 規則が `local_execution` を求めたときに立つ。
   * **cloud の surface で動かしてはいけない**という意味。
   */
  readonly requiresLocalExecution: boolean;
  readonly externalEffect: boolean;
  /** なぜそう決まったか。承認カードには出さず、監査とデバッグに使う。 */
  readonly reasons: readonly string[];
}

export function evaluate(context: ActionContext): PolicyDecision {
  const { risk, complianceProfile } = context;
  const strict = STRICT_PROFILES.includes(complianceProfile);
  const write = isWrite(risk);
  const reasons: string[] = [];

  let requiresApproval = BASE_REQUIRES_APPROVAL[risk];
  if (requiresApproval) reasons.push(`risk:${risk}`);

  if (context.toolRequiresConfirmation === true && !requiresApproval) {
    requiresApproval = true;
    reasons.push('tool:requires_confirmation');
  }

  // 正本 §15.5 / §15.6 / §22: 規制領域では write-back を必ず明示承認にする。
  // 「取り消せるから聞かない」という一般則を規制領域へ持ち込まない。
  if (strict && write && !requiresApproval) {
    requiresApproval = true;
    reasons.push(`profile:${complianceProfile}`);
  }

  // 正本 §22 FINANCIAL: order preview mandatory。金額と注文種別の読み返しを必須にする。
  const requiresReadback = risk === 'FINANCIAL';
  if (requiresReadback) reasons.push('financial:readback');

  // 規制領域では参照も監査対象（アクセスログ自体が要件になる）。
  const requiresAudit = write || strict;
  if (!write && strict) reasons.push(`profile:${complianceProfile}:audit_reads`);

  let requiresReceipt = write;
  let denied = false;
  /*
   * 規則が求めた読み上げ。
   *
   * **要求そのものを見る。**以前はここが規則 id に 'order-preview' が
   * 含まれるかで決まっていて、`require: readback` と書いた規則は
   * 検証も一致もするのに**何もしていなかった**。
   */
  let policyWantsReadback = false;
  /** 規則が「手元でだけ実行する」と言ったか。 */
  let policyWantsLocal = false;
  const appliedRules: string[] = [];

  /*
   * plugin が持ち込んだ規則と、profile ごとの組み込み規則（正本 §22）。
   *
   * **組み込みは plugin の宣言に頼らない。**書き忘れても効く必要がある。
   * 規則は**厳しくする方向にしか働かない**。緩める口を作ると、
   * plugin が自分で自分を緩められることになる。
   */
  const documents = [...builtInPoliciesFor(complianceProfile), ...(context.policies ?? [])];
  if (documents.length > 0) {
    const outcome = evaluatePolicyDocuments(documents, {
      toolId: context.toolId ?? '',
      risk,
      surface: context.surface ?? 'cloud',
      complianceProfile,
    });

    for (const rule of outcome.blocking) {
      appliedRules.push(rule.ruleId);
      switch (rule.requirement) {
        case 'confirmation':
          if (!requiresApproval) {
            requiresApproval = true;
            reasons.push(`policy:${rule.ruleId}`);
          }
          break;
        case 'receipt':
          requiresReceipt = true;
          break;
        case 'audit':
          // requiresAudit は下で使うので、ここでは印だけ
          reasons.push(`policy:${rule.ruleId}`);
          break;
        case 'readback':
          policyWantsReadback = true;
          reasons.push(`policy:${rule.ruleId}`);
          break;
        case 'local_execution':
          policyWantsLocal = true;
          reasons.push(`policy:${rule.ruleId}`);
          break;
        case 'deny':
          reasons.push(`policy:${rule.ruleId}`);
          break;
      }
    }
    for (const rule of outcome.warnings) appliedRules.push(`warn:${rule.ruleId}`);
    denied = outcome.denied;
  }

  const policyWantsAudit = appliedRules.some((id) => id.includes('audit'));

  return {
    denied,
    appliedRules,
    requiresApproval,
    requiresReadback: requiresReadback || policyWantsReadback,
    requiresReceipt,
    requiresAudit: requiresAudit || policyWantsAudit,
    /** 規則が手元での実行を求めたか。正本 §16.1 の local-first を規則から要求できる。 */
    requiresLocalExecution: policyWantsLocal,
    externalEffect: hasExternalEffect(risk),
    reasons,
  };
}

/**
 * 承認の有効期限。既定は 24 時間（実装仕様 §6.5 の承認待ち上限と一致させる）。
 *
 * FINANCIAL だけ 5 分。価格が動くため、古い承認で発注させない
 * （正本 §25「stale approval」の観点）。
 */
export const DEFAULT_APPROVAL_TTL_MS = 24 * 60 * 60 * 1000;
export const FINANCIAL_APPROVAL_TTL_MS = 5 * 60 * 1000;

export function approvalTtlMs(risk: ActionRisk): number {
  return risk === 'FINANCIAL' ? FINANCIAL_APPROVAL_TTL_MS : DEFAULT_APPROVAL_TTL_MS;
}

export interface ApprovalLike {
  readonly status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'EXPIRED';
  readonly expiresAt: string;
}

/** 承認を実行に使ってよいか。期限切れの承認で実行しない。 */
export function isApprovalUsable(approval: ApprovalLike, now: Date = new Date()): boolean {
  return approval.status === 'APPROVED' && new Date(approval.expiresAt).getTime() > now.getTime();
}

/** 全リスク区分が基本表に載っていることを型と実行時の両方で保証する。 */
export const COVERED_RISKS: readonly ActionRisk[] = ACTION_RISKS;
export function assertRiskTableComplete(): void {
  for (const risk of ACTION_RISKS) {
    if (!(risk in BASE_REQUIRES_APPROVAL)) {
      throw new Error(`risk ${risk} is missing from the approval table`);
    }
  }
}

export { ActionRisk };
