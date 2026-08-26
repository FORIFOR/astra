/**
 * Plugin が持ち込む policy。正本 §22。
 *
 * **散文では機械検査できない。**
 * 「根拠を必ず添える」と書いてあっても、host はそれを確かめられない。
 * dashboard（データであってコードではない）や workflow（決まった条件だけ）と
 * 同じ考え方で、**host が実装した語彙だけ**を書けるようにする。
 *
 * 語彙に無いことを書きたくなったら、それは host 側に足す話であって、
 * plugin が自由に書ける口を開ける話ではない。
 */
import { z } from 'zod';
import { ActionRisk } from './approval.js';
import { Sensitivity } from './artifact.js';
import { ComplianceProfile } from './plugin.js';
import { ExecutionSurface } from './surface.js';

/** いつ効くか。**host が判定できるものだけ。** */
export const PolicyCondition = z.discriminatedUnion('when', [
  z.object({ when: z.literal('always') }),
  z.object({ when: z.literal('risk_at_least'), risk: ActionRisk }),
  z.object({ when: z.literal('tool_is'), tools: z.array(z.string().min(1)).min(1).max(50) }),
  z.object({ when: z.literal('surface_is'), surface: ExecutionSurface }),
  z.object({ when: z.literal('sensitivity_at_least'), sensitivity: Sensitivity }),
]);
export type PolicyCondition = z.infer<typeof PolicyCondition>;

/**
 * 何を要求するか。**host が実際に行えることだけ。**
 *
 * `deny` は「この組み合わせは実行しない」。
 * 規制領域では「確認すれば通る」ではなく「そもそもやらない」が要ることがある。
 */
export const PolicyRequirement = z.enum([
  'confirmation',
  'receipt',
  'audit',
  'readback',
  'local_execution',
  'deny',
]);
export type PolicyRequirement = z.infer<typeof PolicyRequirement>;

export const PolicyRule = z.object({
  id: z.string().regex(/^[a-z][a-z0-9-]*$/),
  /** 人が読む説明。**判定には使わない。** */
  description: z.string().min(1).max(300),
  when: PolicyCondition.default({ when: 'always' }),
  require: PolicyRequirement,
  /**
   * `block` は満たせないなら実行しない。`warn` は記録だけ。
   * **既定は block。**緩いほうを既定にすると、書き忘れが素通りする。
   */
  severity: z.enum(['block', 'warn']).default('block'),
});
export type PolicyRule = z.infer<typeof PolicyRule>;

export const PolicyDocument = z.object({
  id: z.string().regex(/^[a-z][a-z0-9-]*$/),
  /** どの profile 向けか。省略なら全部。 */
  profiles: z.array(ComplianceProfile).default([]),
  rules: z.array(PolicyRule).min(1).max(50),
});
export type PolicyDocument = z.infer<typeof PolicyDocument>;

// ------------------------------------------------------------- evaluation

const RISK_ORDER: readonly ActionRisk[] = [
  'READ',
  'REVERSIBLE_WRITE',
  'EXTERNAL_COMMIT',
  'DESTRUCTIVE',
  'REGULATED',
  'FINANCIAL',
];

const SENSITIVITY_ORDER: readonly Sensitivity[] = [
  'PUBLIC',
  'PRIVATE',
  'CONFIDENTIAL',
  'REGULATED',
];

export interface PolicyTarget {
  readonly toolId: string;
  readonly risk: ActionRisk;
  readonly surface: ExecutionSurface;
  readonly complianceProfile: ComplianceProfile;
  readonly sensitivity?: Sensitivity;
}

/** その規則が、この step に効くか。 */
export function ruleApplies(rule: PolicyRule, target: PolicyTarget): boolean {
  switch (rule.when.when) {
    case 'always':
      return true;
    case 'risk_at_least':
      return RISK_ORDER.indexOf(target.risk) >= RISK_ORDER.indexOf(rule.when.risk);
    case 'tool_is':
      return rule.when.tools.includes(target.toolId);
    case 'surface_is':
      return target.surface === rule.when.surface;
    case 'sensitivity_at_least':
      return (
        SENSITIVITY_ORDER.indexOf(target.sensitivity ?? 'PRIVATE') >=
        SENSITIVITY_ORDER.indexOf(rule.when.sensitivity)
      );
  }
}

export interface PolicyRuleOutcome {
  readonly ruleId: string;
  readonly requirement: PolicyRequirement;
  readonly severity: 'block' | 'warn';
  readonly description: string;
}

export interface PolicyDocumentOutcome {
  /** 満たさなければ実行しないもの。 */
  readonly blocking: readonly PolicyRuleOutcome[];
  /** 記録だけするもの。 */
  readonly warnings: readonly PolicyRuleOutcome[];
  /** 実行そのものを止めるか。 */
  readonly denied: boolean;
}

/**
 * 効く規則を集める。
 *
 * **profile が合わない document は見ない。**
 * GENERAL の plugin が REGULATED 向けの規則を持っていても、
 * それは効かせる話ではない（逆に、効かせると誤って厳しくなる）。
 */
export function evaluatePolicyDocuments(
  documents: readonly PolicyDocument[],
  target: PolicyTarget,
): PolicyDocumentOutcome {
  const blocking: PolicyRuleOutcome[] = [];
  const warnings: PolicyRuleOutcome[] = [];
  let denied = false;

  for (const document of documents) {
    if (document.profiles.length > 0 && !document.profiles.includes(target.complianceProfile)) {
      continue;
    }
    for (const rule of document.rules) {
      if (!ruleApplies(rule, target)) continue;
      const outcome: PolicyRuleOutcome = {
        ruleId: `${document.id}/${rule.id}`,
        requirement: rule.require,
        severity: rule.severity,
        description: rule.description,
      };
      if (rule.severity === 'warn') {
        warnings.push(outcome);
        continue;
      }
      blocking.push(outcome);
      if (rule.require === 'deny') denied = true;
    }
  }

  return { blocking, warnings, denied };
}

/**
 * 正本 §22 が profile ごとに定めているもの。
 *
 * **plugin の宣言に頼らない。**plugin が書き忘れても効く必要がある。
 * ここにあるのは「その profile なら必ず」のものだけ。
 */
export const BUILT_IN_POLICIES: Readonly<Record<ComplianceProfile, PolicyDocument | null>> = {
  GENERAL: null,
  ENTERPRISE: null,
  REGULATED_HEALTH: {
    id: 'builtin-regulated-health',
    profiles: ['REGULATED_HEALTH'],
    rules: [
      {
        id: 'write-approval',
        description: '記録への書き込みは明示承認を取る',
        when: { when: 'risk_at_least', risk: 'REVERSIBLE_WRITE' },
        require: 'confirmation',
        severity: 'block',
      },
      {
        id: 'audit-everything',
        description: '参照も含めて監査に残す',
        when: { when: 'always' },
        require: 'audit',
        severity: 'block',
      },
      {
        id: 'no-autonomous-destruction',
        description: '診療記録の破壊的操作は自律的に行わない',
        when: { when: 'risk_at_least', risk: 'DESTRUCTIVE' },
        require: 'deny',
        severity: 'block',
      },
    ],
  },
  CARE: {
    id: 'builtin-care',
    profiles: ['CARE'],
    rules: [
      {
        id: 'write-approval',
        description: 'ケア記録への書き込みは明示承認を取る',
        when: { when: 'risk_at_least', risk: 'REVERSIBLE_WRITE' },
        require: 'confirmation',
        severity: 'block',
      },
      {
        id: 'audit-everything',
        description: '参照も含めて監査に残す',
        when: { when: 'always' },
        require: 'audit',
        severity: 'block',
      },
    ],
  },
  FINANCIAL: {
    id: 'builtin-financial',
    profiles: ['FINANCIAL'],
    rules: [
      {
        id: 'order-preview',
        description: '金額と注文種別を読み返してから実行する',
        when: { when: 'risk_at_least', risk: 'FINANCIAL' },
        require: 'readback',
        severity: 'block',
      },
      {
        id: 'explicit-confirmation',
        description: '発注は明示確認を取る',
        when: { when: 'risk_at_least', risk: 'EXTERNAL_COMMIT' },
        require: 'confirmation',
        severity: 'block',
      },
      {
        id: 'broker-receipt',
        description: '約定の記録を残す',
        when: { when: 'risk_at_least', risk: 'EXTERNAL_COMMIT' },
        require: 'receipt',
        severity: 'block',
      },
    ],
  },
};

/** その profile に必ず効く規則。plugin の document と合わせて評価する。 */
export function builtInPoliciesFor(profile: ComplianceProfile): PolicyDocument[] {
  const document = BUILT_IN_POLICIES[profile];
  return document ? [document] : [];
}
