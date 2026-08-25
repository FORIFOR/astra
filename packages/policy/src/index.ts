/**
 * @astra/policy
 *
 * 「この操作に承認が要るか」「receipt と監査が要るか」を決める唯一の場所。
 * 正本 §9 / §22、実装仕様 §3.4。
 */
export {
  evaluate,
  isWrite,
  hasExternalEffect,
  approvalTtlMs,
  isApprovalUsable,
  assertRiskTableComplete,
  COVERED_RISKS,
  DEFAULT_APPROVAL_TTL_MS,
  FINANCIAL_APPROVAL_TTL_MS,
  type ActionContext,
  type PolicyDecision,
  type ApprovalLike,
} from './risk.js';
