/**
 * Plugin が持ち込む Workflow と Evaluation。正本 §14・§25。
 */
import { describe, expect, it } from 'vitest';
import { EvalFile, WorkflowDef, WorkflowFile, stepApplies } from '../src/workflow.js';

const step = (over: Record<string, unknown> = {}) => ({
  tool: 'crm.pipeline',
  message: '商談の状況をまとめています',
  ...over,
});

const workflow = (over: Record<string, unknown> = {}) => ({
  id: 'pipeline-review',
  title: 'パイプラインを見る',
  agent: 'analyst',
  steps: [step()],
  ...over,
});

describe('WorkflowDef', () => {
  it('needs at least one step, and caps how long it can get', () => {
    expect(WorkflowDef.safeParse(workflow({ steps: [] })).success).toBe(false);
    const many = Array.from({ length: 21 }, (_, i) => step({ tool: `t${i}` }));
    expect(WorkflowDef.safeParse(workflow({ steps: many })).success).toBe(false);
  });

  it('refuses the same tool twice under the same condition', () => {
    // たいてい書き間違い
    expect(WorkflowDef.safeParse(workflow({ steps: [step(), step()] })).success).toBe(false);
    // 条件が違えば通る
    expect(
      WorkflowDef.safeParse(
        workflow({
          steps: [step(), step({ condition: { when: 'input_present', key: 'deep' } })],
        }),
      ).success,
    ).toBe(true);
  });

  it('makes every step say what it is doing', () => {
    expect(WorkflowDef.safeParse(workflow({ steps: [{ tool: 'x' }] })).success).toBe(false);
  });

  it('defaults to running every step', () => {
    const parsed = WorkflowDef.parse(workflow());
    expect(parsed.steps[0]!.condition).toEqual({ when: 'always' });
  });

  it('does not let a plugin write an arbitrary condition', () => {
    // 任意の式は書かせない
    expect(
      WorkflowDef.safeParse(
        workflow({ steps: [step({ condition: { when: 'eval', code: '1===1' } })] }),
      ).success,
    ).toBe(false);
  });
});

describe('stepApplies', () => {
  const context = { input: { deep: true }, previous: { sources: 3 } };

  it('runs an unconditional step', () => {
    expect(stepApplies({ when: 'always' }, context)).toBe(true);
  });

  it('checks what the input has and does not have', () => {
    expect(stepApplies({ when: 'input_present', key: 'deep' }, context)).toBe(true);
    expect(stepApplies({ when: 'input_present', key: 'missing' }, context)).toBe(false);
    expect(stepApplies({ when: 'input_absent', key: 'missing' }, context)).toBe(true);
  });

  it('treats null as absent, not as present', () => {
    const nulled = { input: { deep: null }, previous: null };
    expect(stepApplies({ when: 'input_present', key: 'deep' }, nulled)).toBe(false);
    expect(stepApplies({ when: 'input_absent', key: 'deep' }, nulled)).toBe(true);
  });

  it('needs a previous step before it can look at one', () => {
    expect(
      stepApplies({ when: 'previous_produced', key: 'sources' }, { input: {}, previous: null }),
    ).toBe(false);
    expect(stepApplies({ when: 'previous_produced', key: 'sources' }, context)).toBe(true);
  });
});

describe('EvalFile', () => {
  it('does not let a plugin declare itself passing', () => {
    // 期待を書かせ、判定は harness が行う
    const parsed = EvalFile.safeParse({
      cases: [
        {
          id: 'x',
          description: '何かを確かめる',
          workflow: 'pipeline-review',
          input: {},
          expect: { steps_ran: ['crm.pipeline'] },
        },
      ],
    });
    expect(parsed.success).toBe(true);
    expect(Object.keys(parsed.data!.cases[0]!.expect)).not.toContain('passed');
  });

  it('lets a case expect a failure', () => {
    const parsed = EvalFile.parse({
      cases: [
        {
          id: 'x',
          description: '落ちること自体を確かめる',
          workflow: 'w',
          input: {},
          expect: { fails: true },
        },
      ],
    });
    expect(parsed.cases[0]!.expect.fails).toBe(true);
  });
});

describe('WorkflowFile', () => {
  it('takes the bundled Sales CRM workflow as it is', async () => {
    const { readFile } = await import('node:fs/promises');
    const { fileURLToPath } = await import('node:url');
    const raw = await readFile(
      fileURLToPath(
        new URL('../../../plugins/builtin/sales-crm/workflows/analysis.json', import.meta.url),
      ),
      'utf8',
    );
    const parsed = WorkflowFile.safeParse(JSON.parse(raw));
    expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
  });
});
