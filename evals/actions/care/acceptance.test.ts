/**
 * Care Support。正本 §15.4「REGULATED policy required」。
 *
 * **宣言だけで終わらせない。**CARE profile の plugin の書き込みが、
 * 実際に確認と読み上げと監査を通ることを、規則エンジンで確かめる。
 */
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { PolicyDocument, builtInPoliciesFor } from '@astra/contracts';
import { isStrictProfile } from '@astra/service-plugin-registry';
import { evaluate } from '@astra/policy';

const root = fileURLToPath(new URL('../../..', import.meta.url));

const manifest = async (): Promise<Record<string, unknown>> =>
  parse(await readFile(`${root}/plugins/builtin/care/plugin.yaml`, 'utf8')) as Record<
    string,
    unknown
  >;

const rules = async (): Promise<PolicyDocument> =>
  PolicyDocument.parse(
    parse(await readFile(`${root}/plugins/builtin/care/policies/care.yaml`, 'utf8')),
  );

describe('the plugin declares what §15.4 requires', () => {
  it('runs under a regulated profile', async () => {
    const profile = (await manifest())['compliance_profile'] as string;
    expect(profile).toBe('CARE');
    expect(isStrictProfile(profile as never)).toBe(true);
  });

  it('ships enforceable rules, not prose', async () => {
    const document = await rules();
    expect(document.rules.length).toBeGreaterThan(0);
    for (const rule of document.rules) {
      // 散文の規則は publish で落ちる。ここでも語彙であることを見る。
      expect(rule.when.when).toBeTruthy();
      expect(rule.require).toBeTruthy();
    }
  });

  it('marks the only writing tool as needing confirmation', async () => {
    const tools = (await manifest())['tools'] as {
      id: string;
      risk: string;
      requires_confirmation?: boolean;
    }[];
    const writing = tools.filter((t) => t.risk !== 'READ');
    expect(writing).toHaveLength(1);
    expect(writing[0]!.id).toBe('care.incident_draft');
    expect(writing[0]!.requires_confirmation).toBe(true);
  });
});

describe('what the rules actually do', () => {
  const context = (over: Record<string, unknown> = {}) => ({
    risk: 'REVERSIBLE_WRITE' as const,
    surface: 'cloud' as const,
    toolId: 'care.incident_draft',
    complianceProfile: 'CARE' as const,
    ...over,
  });

  it('will not let a care record be written without a person confirming', async () => {
    const decision = evaluate({
      ...context(),
      policies: [await rules(), ...builtInPoliciesFor('CARE')],
    } as never);
    expect(decision.requiresApproval).toBe(true);
    expect(decision.requiresReadback).toBe(true);
    expect(decision.denied).toBe(false);
  });

  it('audits even a read', async () => {
    const decision = evaluate({
      ...context({ risk: 'READ', toolId: 'care.handoff' }),
      policies: [await rules(), ...builtInPoliciesFor('CARE')],
    } as never);
    // 個人の記録は、見たことも残る
    expect(decision.requiresAudit).toBe(true);
  });

  it('refuses to destroy a record at all', async () => {
    const decision = evaluate({
      ...context({ risk: 'DESTRUCTIVE' }),
      policies: [await rules(), ...builtInPoliciesFor('CARE')],
    } as never);
    // 確認すれば通る、ではない
    expect(decision.denied).toBe(true);
  });
});
