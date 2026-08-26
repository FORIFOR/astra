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

describe('the local-first boundary', () => {
  it('is a promise, so a local tool must not silently run in the cloud', () => {
    // `surface` は正本 §16 の境界そのもの。素通しすると宣言だけの約束になる。
    const plan = planInstalledAgent(
      agent({
        complianceProfile: 'GENERAL',
        tools: [
          { id: 'finder.search', risk: 'READ', surface: 'local', requiresConfirmation: false },
        ],
      }),
      {},
    );
    expect(plan.steps[0]!.surface).toBe('local');
  });
});

describe('what a failed step leaves behind', () => {
  it('unwraps the reason instead of recording the wrapper', () => {
    // Temporal は activity の失敗を "Activity task failed" で包む。
    // そのまま記録すると、何も言っていないエラーが残る。
    const cause = new Error('finder.search is declared local');
    const wrapper = new Error('Activity task failed', { cause });

    let current: unknown = wrapper;
    let deepest = '';
    for (let depth = 0; depth < 8 && current instanceof Error; depth += 1) {
      if (current.message) deepest = current.message;
      current = (current as { cause?: unknown }).cause;
    }
    expect(deepest).toBe('finder.search is declared local');
  });

  it('stops walking a cycle instead of hanging', () => {
    const a = new Error('a');
    const b = new Error('b', { cause: a });
    (a as { cause?: unknown }).cause = b;

    let current: unknown = a;
    let steps = 0;
    for (let depth = 0; depth < 8 && current instanceof Error; depth += 1) {
      steps += 1;
      current = (current as { cause?: unknown }).cause;
    }
    expect(steps).toBe(8);
  });
});
