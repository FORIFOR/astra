/**
 * step が policy へ何を渡すか。正本 §9.2 / §22。
 *
 * ここは**一度壊れていた**場所。`complianceProfile: 'GENERAL'` が
 * 固定で書き込まれており、規制区分の plugin も一般として評価されていた。
 * `requires_confirmation` も manifest で検証されるだけで効いていなかった。
 */
import { describe, expect, it } from 'vitest';
import { evaluate } from '@astra/policy';
import { planInstalledAgent, type InstalledAgent } from '../src/agent-plan.js';

const agent = (over: Partial<InstalledAgent> = {}): InstalledAgent => ({
  pluginId: 'com.acme.care',
  agentId: 'assistant',
  agentName: 'Care Assistant',
  complianceProfile: 'CARE',
  tools: [
    { id: 'care.note', risk: 'REVERSIBLE_WRITE', surface: 'cloud', requiresConfirmation: false },
  ],
  skill: null,
  grantedScopes: [],
  requiredScopes: [],
  ...over,
});

/** activities が使うのと同じ組み立て。 */
const contextFor = (step: {
  risk: string;
  surface: 'local' | 'cloud';
  requiresConfirmation?: boolean;
  complianceProfile?: string;
}) =>
  evaluate({
    risk: step.risk as never,
    surface: step.surface,
    complianceProfile: (step.complianceProfile ?? 'GENERAL') as never,
    ...(step.requiresConfirmation === undefined
      ? {}
      : { toolRequiresConfirmation: step.requiresConfirmation }),
  });

describe('what a plugin agent puts on its steps', () => {
  it('carries the plugin’s compliance profile', () => {
    const plan = planInstalledAgent(agent(), {});
    expect(plan.steps[0]!.complianceProfile).toBe('CARE');
  });

  it('carries the author’s confirmation flag', () => {
    const plan = planInstalledAgent(
      agent({
        tools: [{ id: 'x.read', risk: 'READ', surface: 'cloud', requiresConfirmation: true }],
      }),
      {},
    );
    expect(plan.steps[0]!.requiresConfirmation).toBe(true);
  });
});

describe('what the policy then decides', () => {
  it('asks for approval on a regulated write that a general profile would wave through', () => {
    // 「取り消せるから聞かない」を規制領域へ持ち込まない（正本 §22）
    const general = contextFor({ risk: 'REVERSIBLE_WRITE', surface: 'cloud' });
    expect(general.requiresApproval).toBe(false);

    const care = contextFor({
      risk: 'REVERSIBLE_WRITE',
      surface: 'cloud',
      complianceProfile: 'CARE',
    });
    expect(care.requiresApproval).toBe(true);
    expect(care.reasons).toContain('profile:CARE');
  });

  it('audits even a read in a regulated domain', () => {
    // 規制領域ではアクセスログ自体が要件になる
    expect(contextFor({ risk: 'READ', surface: 'cloud' }).requiresAudit).toBe(false);
    expect(
      contextFor({ risk: 'READ', surface: 'cloud', complianceProfile: 'REGULATED_HEALTH' })
        .requiresAudit,
    ).toBe(true);
  });

  it('honours a confirmation the author asked for on a low-risk tool', () => {
    expect(contextFor({ risk: 'READ', surface: 'cloud' }).requiresApproval).toBe(false);
    const asked = contextFor({ risk: 'READ', surface: 'cloud', requiresConfirmation: true });
    expect(asked.requiresApproval).toBe(true);
    expect(asked.reasons).toContain('tool:requires_confirmation');
  });

  it('still reads back money, whatever the profile says', () => {
    expect(contextFor({ risk: 'FINANCIAL', surface: 'cloud' }).requiresReadback).toBe(true);
  });

  it('leaves a built-in step as GENERAL when nothing was declared', () => {
    // 組み込みの kind は profile を持たない。既定が変わってはいけない。
    const decision = contextFor({ risk: 'READ', surface: 'cloud' });
    expect(decision.requiresApproval).toBe(false);
    expect(decision.requiresAudit).toBe(false);
  });
});
