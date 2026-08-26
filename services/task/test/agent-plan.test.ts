/**
 * install した agent の計画。Phase 5 実装仕様 §2。
 * ここは DB を要らない部分だけ。
 */
import { describe, expect, it } from 'vitest';
import {
  AgentNotRunnableError,
  agentKindFor,
  parseAgentKind,
  planInstalledAgent,
  type InstalledAgent,
} from '../src/agent-plan.js';

const agent = (over: Partial<InstalledAgent> = {}): InstalledAgent => ({
  pluginId: 'com.acme.crm',
  agentId: 'analyst',
  agentName: 'CRM Analyst',
  complianceProfile: 'GENERAL',
  tools: [
    { id: 'crm.search', risk: 'READ', surface: 'cloud', requiresConfirmation: false },
    {
      id: 'crm.update',
      risk: 'EXTERNAL_COMMIT',
      surface: 'cloud',
      requiresConfirmation: true,
    },
  ],
  skill: '# CRM Analyst\n根拠のない断定をしない。',
  grantedScopes: ['crm.read', 'crm.write'],
  requiredScopes: ['crm.read', 'crm.write'],
  ...over,
});

describe('the agent kind', () => {
  it('round-trips a plugin id that contains dots', () => {
    const kind = agentKindFor('com.acme.crm', 'analyst');
    expect(kind).toBe('plugin:com.acme.crm:analyst');
    // 最後の `:` で割る。最初で割ると plugin id が切れる。
    expect(parseAgentKind(kind)).toEqual({ pluginId: 'com.acme.crm', agentId: 'analyst' });
  });

  it('refuses anything that is not an agent kind', () => {
    for (const bad of ['echo', 'plugin:', 'plugin:only', 'plugin:x:', 'plugin::y', '']) {
      expect(parseAgentKind(bad), bad).toBeNull();
    }
  });
});

describe('planInstalledAgent', () => {
  it('plans one step per declared tool, in order', () => {
    const plan = planInstalledAgent(agent(), { message: '今月の商談を分析して' });
    expect(plan.steps.map((s) => s.toolId)).toEqual(['crm.search', 'crm.update']);
    expect(plan.steps.map((s) => s.index)).toEqual([0, 1]);
  });

  it('carries the risk each tool declared, so approval still applies', () => {
    const plan = planInstalledAgent(agent(), {});
    expect(plan.steps[1]!.risk).toBe('EXTERNAL_COMMIT');
  });

  it('refuses to start when a required scope was never granted', () => {
    // 走らせてから step ごとに落とすと、途中までの副作用が残る
    expect(() => planInstalledAgent(agent({ grantedScopes: ['crm.read'] }), {})).toThrow(
      AgentNotRunnableError,
    );

    try {
      planInstalledAgent(agent({ grantedScopes: [] }), {});
    } catch (error) {
      expect((error as AgentNotRunnableError).reason).toBe('missing_scopes');
      expect((error as AgentNotRunnableError).missing).toEqual(['crm.read', 'crm.write']);
    }
  });

  it('hands the skill to every step so the tool can use it', () => {
    const plan = planInstalledAgent(agent(), {});
    expect(plan.steps[0]!.args['skill']).toContain('CRM Analyst');
  });

  it('leaves the skill out entirely when the plugin shipped none', () => {
    const plan = planInstalledAgent(agent({ skill: null }), {});
    expect('skill' in plan.steps[0]!.args).toBe(false);
  });

  it('does not put the tool id in front of the user', () => {
    // 正本 §7.2 / §9.3: tool 名を見せない
    const plan = planInstalledAgent(agent(), {});
    for (const step of plan.steps) {
      expect(step.message).not.toContain('crm.');
      expect(step.message).toContain('CRM Analyst');
    }
  });

  it('plans nothing to run when the agent declares no usable tool', () => {
    const plan = planInstalledAgent(agent({ tools: [] }), {});
    expect(plan.steps).toEqual([]);
  });
});
