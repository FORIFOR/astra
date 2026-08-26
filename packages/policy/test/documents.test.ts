/**
 * plugin が持ち込む policy が、実際に効くこと。正本 §22。
 *
 * これまでは publish で「ファイルがあること」しか見ておらず、
 * **規則そのものは一度も実行されていなかった**（OQ-25）。
 */
import { describe, expect, it } from 'vitest';
import {
  BUILT_IN_POLICIES,
  builtInPoliciesFor,
  evaluatePolicyDocuments,
  ruleApplies,
  type PolicyDocument,
} from '@astra/contracts';
import { evaluate } from '../src/risk.js';

const doc = (rules: PolicyDocument['rules'], profiles: PolicyDocument['profiles'] = []) =>
  ({ id: 'test', profiles, rules }) as PolicyDocument;

describe('ruleApplies', () => {
  const target = {
    toolId: 'crm.update',
    risk: 'EXTERNAL_COMMIT',
    surface: 'cloud',
    complianceProfile: 'GENERAL',
  } as const;

  it('matches by how heavy the action is', () => {
    expect(
      ruleApplies(
        {
          id: 'r',
          description: 'd',
          when: { when: 'risk_at_least', risk: 'REVERSIBLE_WRITE' },
          require: 'confirmation',
          severity: 'block',
        },
        target,
      ),
    ).toBe(true);
    expect(
      ruleApplies(
        {
          id: 'r',
          description: 'd',
          when: { when: 'risk_at_least', risk: 'FINANCIAL' },
          require: 'confirmation',
          severity: 'block',
        },
        target,
      ),
    ).toBe(false);
  });

  it('matches a named tool', () => {
    expect(
      ruleApplies(
        {
          id: 'r',
          description: 'd',
          when: { when: 'tool_is', tools: ['crm.update'] },
          require: 'deny',
          severity: 'block',
        },
        target,
      ),
    ).toBe(true);
  });
});

describe('evaluatePolicyDocuments', () => {
  const target = {
    toolId: 'x.write',
    risk: 'REVERSIBLE_WRITE',
    surface: 'cloud',
    complianceProfile: 'GENERAL',
  } as const;

  it('ignores a document meant for another profile', () => {
    // GENERAL の plugin に REGULATED 向けの規則を効かせない
    const outcome = evaluatePolicyDocuments(
      [
        doc(
          [
            {
              id: 'r',
              description: 'd',
              when: { when: 'always' },
              require: 'deny',
              severity: 'block',
            },
          ],
          ['CARE'],
        ),
      ],
      target,
    );
    expect(outcome.blocking).toEqual([]);
    expect(outcome.denied).toBe(false);
  });

  it('separates what blocks from what only warns', () => {
    const outcome = evaluatePolicyDocuments(
      [
        doc([
          {
            id: 'hard',
            description: 'd',
            when: { when: 'always' },
            require: 'confirmation',
            severity: 'block',
          },
          {
            id: 'soft',
            description: 'd',
            when: { when: 'always' },
            require: 'audit',
            severity: 'warn',
          },
        ]),
      ],
      target,
    );
    expect(outcome.blocking.map((r) => r.ruleId)).toEqual(['test/hard']);
    expect(outcome.warnings.map((r) => r.ruleId)).toEqual(['test/soft']);
  });
});

describe('evaluate with policies', () => {
  const base = {
    risk: 'REVERSIBLE_WRITE',
    complianceProfile: 'GENERAL',
    toolId: 'x.write',
  } as const;

  it('a rule can require confirmation where risk alone would not', () => {
    expect(evaluate(base).requiresApproval).toBe(false);

    const withPolicy = evaluate({
      ...base,
      policies: [
        doc([
          {
            id: 'confirm-writes',
            description: '書き込みは確認する',
            when: { when: 'risk_at_least', risk: 'REVERSIBLE_WRITE' },
            require: 'confirmation',
            severity: 'block',
          },
        ]),
      ],
    });
    expect(withPolicy.requiresApproval).toBe(true);
    expect(withPolicy.appliedRules).toContain('test/confirm-writes');
  });

  it('a rule cannot make things looser', () => {
    // plugin が自分で自分を緩められてはいけない
    const strict = evaluate({ risk: 'EXTERNAL_COMMIT', complianceProfile: 'GENERAL' });
    expect(strict.requiresApproval).toBe(true);

    const withPermissive = evaluate({
      risk: 'EXTERNAL_COMMIT',
      complianceProfile: 'GENERAL',
      policies: [
        doc([
          {
            id: 'nothing',
            description: '何も要らない',
            when: { when: 'always' },
            require: 'audit',
            severity: 'warn',
          },
        ]),
      ],
    });
    expect(withPermissive.requiresApproval).toBe(true);
  });

  it('denies outright when a rule says so', () => {
    // 規制領域では「確認すれば通る」ではなく「そもそもやらない」が要る
    const decision = evaluate({
      ...base,
      policies: [
        doc([
          {
            id: 'never',
            description: 'やらない',
            when: { when: 'tool_is', tools: ['x.write'] },
            require: 'deny',
            severity: 'block',
          },
        ]),
      ],
    });
    expect(decision.denied).toBe(true);
  });
});

describe('the built-in rules (正本 §22)', () => {
  it('apply without the plugin declaring anything', () => {
    // plugin が書き忘れても効く必要がある
    const care = evaluate({ risk: 'REVERSIBLE_WRITE', complianceProfile: 'CARE' });
    expect(care.requiresApproval).toBe(true);
    expect(care.appliedRules.some((r) => r.startsWith('builtin-care/'))).toBe(true);
  });

  it('refuse to destroy a medical record on their own', () => {
    const decision = evaluate({ risk: 'DESTRUCTIVE', complianceProfile: 'REGULATED_HEALTH' });
    expect(decision.denied).toBe(true);
  });

  it('read back money before executing', () => {
    const decision = evaluate({ risk: 'FINANCIAL', complianceProfile: 'FINANCIAL' });
    expect(decision.requiresReadback).toBe(true);
    expect(decision.requiresReceipt).toBe(true);
    expect(decision.requiresApproval).toBe(true);
  });

  it('leave GENERAL alone', () => {
    expect(builtInPoliciesFor('GENERAL')).toEqual([]);
    expect(BUILT_IN_POLICIES['ENTERPRISE']).toBeNull();
    const decision = evaluate({ risk: 'READ', complianceProfile: 'GENERAL' });
    expect(decision.requiresApproval).toBe(false);
    expect(decision.denied).toBe(false);
  });
});
