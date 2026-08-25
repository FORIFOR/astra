import { describe, expect, it } from 'vitest';
import { ACTION_RISKS, type ActionRisk, type ComplianceProfile } from '@astra/contracts';
import {
  DEFAULT_APPROVAL_TTL_MS,
  FINANCIAL_APPROVAL_TTL_MS,
  approvalTtlMs,
  assertRiskTableComplete,
  evaluate,
  hasExternalEffect,
  isApprovalUsable,
  isWrite,
} from '../src/risk.js';

const at = (risk: ActionRisk, profile: ComplianceProfile = 'GENERAL', confirm?: boolean) =>
  evaluate({
    risk,
    complianceProfile: profile,
    ...(confirm === undefined ? {} : { toolRequiresConfirmation: confirm }),
  });

describe('risk table coverage', () => {
  it('covers every risk declared in the product spec §9.2', () => {
    expect(() => assertRiskTableComplete()).not.toThrow();
    for (const risk of ACTION_RISKS) expect(at(risk)).toBeDefined();
  });
});

describe('approval requirement — general profile', () => {
  it.each([
    ['READ', false],
    ['REVERSIBLE_WRITE', false],
    ['EXTERNAL_COMMIT', true],
    ['DESTRUCTIVE', true],
    ['REGULATED', true],
    ['FINANCIAL', true],
  ] as const)('%s requires approval: %s', (risk, expected) => {
    expect(at(risk).requiresApproval).toBe(expected);
  });

  it('matches the worked examples in the product spec', () => {
    // email search → READ / draft create → REVERSIBLE_WRITE / send email → EXTERNAL_COMMIT
    expect(at('READ').requiresApproval).toBe(false);
    expect(at('REVERSIBLE_WRITE').requiresApproval).toBe(false);
    expect(at('EXTERNAL_COMMIT').requiresApproval).toBe(true);
  });

  it('lets a manifest force confirmation on an otherwise silent action', () => {
    expect(at('REVERSIBLE_WRITE', 'GENERAL', true).requiresApproval).toBe(true);
    expect(at('REVERSIBLE_WRITE', 'GENERAL', true).reasons).toContain('tool:requires_confirmation');
  });

  it('does not double-count when the risk already required approval', () => {
    expect(at('DESTRUCTIVE', 'GENERAL', true).reasons).toEqual(['risk:DESTRUCTIVE']);
  });
});

describe('approval requirement — regulated profiles', () => {
  it.each(['REGULATED_HEALTH', 'CARE', 'FINANCIAL'] as const)(
    '%s requires approval for any write, including reversible ones',
    (profile) => {
      expect(at('REVERSIBLE_WRITE', profile).requiresApproval).toBe(true);
      expect(at('REVERSIBLE_WRITE', profile).reasons).toContain(`profile:${profile}`);
    },
  );

  it.each(['REGULATED_HEALTH', 'CARE', 'FINANCIAL'] as const)(
    '%s still does not gate plain reads behind approval',
    (profile) => {
      expect(at('READ', profile).requiresApproval).toBe(false);
    },
  );

  it.each(['REGULATED_HEALTH', 'CARE', 'FINANCIAL'] as const)(
    '%s audits reads as well as writes',
    (profile) => {
      expect(at('READ', profile).requiresAudit).toBe(true);
      expect(at('READ', profile).reasons).toContain(`profile:${profile}:audit_reads`);
    },
  );

  it.each(['GENERAL', 'ENTERPRISE'] as const)('%s does not audit plain reads', (profile) => {
    expect(at('READ', profile).requiresAudit).toBe(false);
  });
});

describe('receipts, audit and external effect', () => {
  it('requires a receipt for every write and none for reads', () => {
    for (const risk of ACTION_RISKS) {
      expect(at(risk).requiresReceipt).toBe(risk !== 'READ');
      expect(isWrite(risk)).toBe(risk !== 'READ');
    }
  });

  it('marks external effect only for actions that leave the system', () => {
    expect(at('READ').externalEffect).toBe(false);
    expect(at('REVERSIBLE_WRITE').externalEffect).toBe(false);
    for (const risk of ['EXTERNAL_COMMIT', 'DESTRUCTIVE', 'REGULATED', 'FINANCIAL'] as const) {
      expect(at(risk).externalEffect).toBe(true);
      expect(hasExternalEffect(risk)).toBe(true);
    }
  });
});

describe('financial readback', () => {
  it('requires a readback only for financial actions', () => {
    for (const risk of ACTION_RISKS) {
      expect(at(risk).requiresReadback).toBe(risk === 'FINANCIAL');
    }
    expect(at('FINANCIAL').reasons).toContain('financial:readback');
  });
});

describe('approval lifetime', () => {
  it('expires financial approvals far sooner than the rest', () => {
    expect(approvalTtlMs('FINANCIAL')).toBe(FINANCIAL_APPROVAL_TTL_MS);
    expect(FINANCIAL_APPROVAL_TTL_MS).toBeLessThan(DEFAULT_APPROVAL_TTL_MS);
    for (const risk of ACTION_RISKS) {
      if (risk !== 'FINANCIAL') expect(approvalTtlMs(risk)).toBe(DEFAULT_APPROVAL_TTL_MS);
    }
  });

  it('refuses to act on a stale or undecided approval', () => {
    const now = new Date('2026-08-26T00:00:00.000Z');
    const future = '2026-08-26T00:10:00.000Z';
    const past = '2026-08-25T23:50:00.000Z';
    expect(isApprovalUsable({ status: 'APPROVED', expiresAt: future }, now)).toBe(true);
    expect(isApprovalUsable({ status: 'APPROVED', expiresAt: past }, now)).toBe(false);
    expect(isApprovalUsable({ status: 'PENDING', expiresAt: future }, now)).toBe(false);
    expect(isApprovalUsable({ status: 'REJECTED', expiresAt: future }, now)).toBe(false);
    expect(isApprovalUsable({ status: 'EXPIRED', expiresAt: future }, now)).toBe(false);
  });
});
