/**
 * Plugin が持ち込む Workflow。正本 §14 Agent Package。
 *
 * いまの `planInstalledAgent` は「宣言された tool を宣言順に並べる」だけで、
 * これは近似でしかない。実際の仕事には
 *
 *   - 条件によって飛ばす step
 *   - 利用者に見せる言葉（tool 名ではない）
 *   - 途中で確認を挟む位置
 *
 * がある。それを**宣言で**書けるようにする。
 *
 * **分岐は書けるが、繰り返しは書けない。**繰り返しを許すと、
 * plugin が止まらない仕事を作れてしまう。
 */
import { z } from 'zod';
import { ActionRisk } from './approval.js';
import { ExecutionSurface } from './surface.js';

/** step を飛ばす条件。**任意の式は書かせない。** */
export const StepCondition = z.discriminatedUnion('when', [
  /** 常に実行する。 */
  z.object({ when: z.literal('always') }),
  /** 入力にその鍵があるとき。 */
  z.object({ when: z.literal('input_present'), key: z.string().min(1).max(64) }),
  /** 入力にその鍵が無いとき。 */
  z.object({ when: z.literal('input_absent'), key: z.string().min(1).max(64) }),
  /** 直前の step が何かを返したとき。 */
  z.object({ when: z.literal('previous_produced'), key: z.string().min(1).max(64) }),
]);
export type StepCondition = z.infer<typeof StepCondition>;

export const WorkflowStep = z.object({
  /** manifest の tools[].id。**宣言に無い tool は publish で落とす。** */
  tool: z.string().min(1).max(100),
  /**
   * 利用者に見せる自然文。**tool 名を出さない**（正本 §7.2 / §9.3）。
   * 「何をしているか」を書く。
   */
  message: z.string().min(1).max(200),
  condition: StepCondition.default({ when: 'always' }),
  /**
   * この step だけ risk を上げる。**下げられない**（下の refine で強制）。
   * 同じ tool でも、文脈によって重くなることがある。
   */
  risk: ActionRisk.optional(),
});
export type WorkflowStep = z.infer<typeof WorkflowStep>;

export const WorkflowDef = z
  .object({
    id: z.string().regex(/^[a-z][a-z0-9_-]*$/),
    title: z.string().min(1).max(100),
    /** どの agent の仕事か。 */
    agent: z.string().min(1).max(64),
    steps: z.array(WorkflowStep).min(1).max(20),
    surface: ExecutionSurface.default('cloud'),
  })
  .superRefine((workflow, ctx) => {
    const seen = new Set<string>();
    for (const [i, step] of workflow.steps.entries()) {
      // 同じ tool を二度並べるのは、たいてい書き間違い
      const key = `${step.tool}:${JSON.stringify(step.condition)}`;
      if (seen.has(key)) {
        ctx.addIssue({
          code: 'custom',
          path: ['steps', i, 'tool'],
          message: `"${step.tool}" appears twice with the same condition`,
        });
      }
      seen.add(key);
    }
  });
export type WorkflowDef = z.infer<typeof WorkflowDef>;

export const WorkflowFile = z.object({
  workflows: z.array(WorkflowDef).min(1).max(20),
});

/** 条件を評価する。**副作用も外部参照も無い。** */
export function stepApplies(
  condition: StepCondition,
  context: {
    readonly input: Readonly<Record<string, unknown>>;
    readonly previous: Readonly<Record<string, unknown>> | null;
  },
): boolean {
  switch (condition.when) {
    case 'always':
      return true;
    case 'input_present':
      return context.input[condition.key] !== undefined && context.input[condition.key] !== null;
    case 'input_absent':
      return context.input[condition.key] === undefined || context.input[condition.key] === null;
    case 'previous_produced':
      return context.previous !== null && context.previous[condition.key] !== undefined;
  }
}

// -------------------------------------------------------------- evaluation

/**
 * Plugin が持ち込む評価。正本 §14・§25。
 *
 * **plugin に「合格した」と言わせない。**期待を書かせ、
 * 判定は harness が行う。自己申告を通すと、評価の意味が無い。
 */
export const EvalCase = z.object({
  id: z.string().regex(/^[a-z][a-z0-9_-]*$/),
  /** 何を確かめたいか。人が読む。 */
  description: z.string().min(1).max(300),
  /** どの workflow / agent を動かすか。 */
  workflow: z.string().min(1).max(64),
  input: z.record(z.string(), z.unknown()),
  expect: z.object({
    /** 成果物にこの文字列が含まれること。 */
    artifact_contains: z.array(z.string().min(1)).max(10).default([]),
    /** これらの step が実行されたこと。 */
    steps_ran: z.array(z.string().min(1)).max(20).default([]),
    /** 確認を求めたこと。 */
    requires_approval: z.boolean().optional(),
    /** 失敗すること自体が期待の場合。 */
    fails: z.boolean().default(false),
  }),
});
export type EvalCase = z.infer<typeof EvalCase>;

export const EvalFile = z.object({
  cases: z.array(EvalCase).min(1).max(50),
});

export const EvalOutcome = z.object({
  case_id: z.string(),
  passed: z.boolean(),
  /** 落ちた理由。通ったときは空。 */
  failures: z.array(z.string()),
});
export type EvalOutcome = z.infer<typeof EvalOutcome>;
