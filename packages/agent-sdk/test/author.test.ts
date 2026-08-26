/**
 * Agent Package を書くための道具。正本 §14。
 *
 * ここが解くのは 1 つ:
 * **宣言どうしの食い違いを、publish まで持っていかない。**
 */
import { describe, expect, it } from 'vitest';
import { PluginManifest } from '@astra/contracts';
import { build, buildEvaluations, review, type PackageDraft } from '../src/author.js';

const draft = (over: Partial<PackageDraft> = {}): PackageDraft => ({
  id: 'com.example.crm',
  name: 'CRM',
  version: '1.0.0',
  publisher: 'example',
  category: 'domain-agent',
  complianceProfile: 'GENERAL',
  executionSurfaces: ['cloud'],
  permissions: ['artifacts.read'],
  dataAccessed: ['Opportunities the user already sees'],
  tools: [{ id: 'crm.search', risk: 'READ' }],
  agents: [{ id: 'analyst', skill: 'skills/analyst.md', tools: ['crm.search'] }],
  ...over,
});

describe('review', () => {
  it('says nothing about a draft that holds together', () => {
    expect(review(draft())).toEqual([]);
  });

  it('catches a heavy tool that does not ask first', () => {
    const problems = review(
      draft({ tools: [{ id: 'crm.send', risk: 'EXTERNAL_COMMIT' }], agents: [] }),
    );
    expect(problems.map((p) => p.message).join()).toContain('確認を求める');
  });

  it('catches a tool that runs somewhere the package did not declare', () => {
    const problems = review(
      draft({ tools: [{ id: 'crm.read', risk: 'READ', surface: 'local' }], agents: [] }),
    );
    expect(problems.map((p) => p.message).join()).toContain('execution_surfaces');
  });

  it('catches an agent reaching for a tool that is not there', () => {
    const problems = review(draft({ agents: [{ id: 'a', skill: 's.md', tools: ['mail.send'] }] }));
    expect(problems.map((p) => p.message).join()).toContain('mail.send');
  });

  it('catches a fallback that is heavier than what it replaces', () => {
    // 落ちたほうが危ないことをするのでは、代わりにならない
    const problems = review(
      draft({
        tools: [
          { id: 'crm.search', risk: 'READ', fallbacks: ['crm.wipe'] },
          { id: 'crm.wipe', risk: 'DESTRUCTIVE', requiresConfirmation: true },
        ],
        agents: [],
      }),
    );
    expect(problems.map((p) => p.message).join()).toContain('元より重い');
  });

  it('catches a workflow that shows the tool name to the user', () => {
    // 正本 §7.2 / §9.3
    const problems = review(
      draft({
        workflows: [
          {
            id: 'w',
            title: 'W',
            agent: 'analyst',
            steps: [{ tool: 'crm.search', message: 'crm.search を実行しています' }],
          },
        ],
      }),
    );
    expect(problems.map((p) => p.message).join()).toContain('tool 名');
  });

  it('catches a regulated package that never says what it will not do', () => {
    const problems = review(draft({ complianceProfile: 'CARE' }));
    expect(problems.map((p) => p.message).join()).toContain('何をしないか');
  });
});

describe('build', () => {
  it('refuses to produce anything while the pieces disagree', () => {
    // 作ってから落ちるより、作る前に断るほうが直しやすい
    expect(() => build(draft({ agents: [{ id: 'a', skill: 's.md', tools: ['nope'] }] }))).toThrow(
      /食い違い/,
    );
  });

  it('produces a manifest the contract itself accepts', () => {
    const built = build(draft());
    expect(() => PluginManifest.parse(built.manifest)).not.toThrow();
  });

  it('writes the workflow only when there is one', () => {
    expect(Object.keys(build(draft()).files)).toEqual([]);

    const withWorkflow = build(
      draft({
        workflows: [
          {
            id: 'review',
            title: '見る',
            agent: 'analyst',
            steps: [{ tool: 'crm.search', message: '商談を探しています' }],
          },
        ],
      }),
    );
    expect(Object.keys(withWorkflow.files)).toContain('workflows/main.json');
    expect(withWorkflow.manifest['workflows']).toEqual(['workflows/main.json']);
  });

  it('writes rules in the vocabulary the host can check', () => {
    const built = build(
      draft({
        rules: [
          {
            id: 'confirm-writes',
            description: '書き込みは確認する',
            when: { when: 'risk_at_least', risk: 'REVERSIBLE_WRITE' },
            require: 'confirmation',
            severity: 'block',
          },
        ],
      }),
    );
    const yaml = built.files['policies/main.yaml']!;
    expect(yaml).toContain('require: confirmation');
    expect(yaml).toContain('risk_at_least');
  });
});

describe('buildEvaluations', () => {
  it('does not let the author write down that it passed', () => {
    // 期待を書かせ、判定は harness が行う
    const json = buildEvaluations([
      {
        id: 'runs-both',
        description: '両方走る',
        workflow: 'review',
        input: {},
        expectSteps: ['crm.search'],
      },
    ]);
    expect(json).toContain('steps_ran');
    expect(json).not.toContain('passed');
  });
});
