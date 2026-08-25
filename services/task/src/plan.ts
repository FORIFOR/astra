/**
 * タスクの計画。**純粋関数のみ**。
 *
 * ワークフローのコードは決定的でなければならないので、このファイルは
 * 乱数・時刻・I/O・Node の API に触れない。`@astra/contracts` も import しない
 * （uuidv7 が Web Crypto を触るため、ワークフローのサンドボックスに持ち込めない）。
 */

export type StepRisk =
  'READ' | 'REVERSIBLE_WRITE' | 'EXTERNAL_COMMIT' | 'DESTRUCTIVE' | 'REGULATED' | 'FINANCIAL';

export interface TaskStep {
  readonly index: number;
  readonly toolId: string;
  readonly risk: StepRisk;
  readonly surface: 'local' | 'cloud';
  /** ユーザーに見せる自然文。tool 名を出さない（正本 §7.2 / §9.3）。 */
  readonly message: string;
  readonly args: Record<string, unknown>;
}

export interface TaskPlan {
  readonly steps: readonly TaskStep[];
  readonly artifact: {
    readonly type: 'REPORT' | 'DOCUMENT' | 'OTHER';
    readonly title: string;
    readonly mimeType: string;
  };
}

export const KNOWN_TASK_KINDS = ['echo'] as const;
export type TaskKind = (typeof KNOWN_TASK_KINDS)[number];

export function isKnownTaskKind(kind: string): kind is TaskKind {
  return (KNOWN_TASK_KINDS as readonly string[]).includes(kind);
}

export class UnknownTaskKindError extends Error {
  constructor(kind: string) {
    super(`unknown task kind: ${kind}`);
    this.name = 'UnknownTaskKindError';
  }
}

const MAX_ECHO_STEPS = 20;

/**
 * Phase 0 の唯一の種別。API → workflow → イベント列 → object store → artifact の
 * 全経路を通すためだけのもの（実装仕様 §6.6）。
 */
function planEcho(input: Record<string, unknown>): TaskPlan {
  const message = typeof input['message'] === 'string' ? input['message'] : 'hello';
  const requested = typeof input['steps'] === 'number' ? Math.floor(input['steps']) : 1;
  const count = Math.min(Math.max(requested, 1), MAX_ECHO_STEPS);
  const requiresApproval = input['require_approval'] === true;

  const steps: TaskStep[] = [];
  for (let i = 0; i < count; i += 1) {
    steps.push({
      index: i,
      toolId: 'noop.echo',
      risk: 'READ',
      surface: 'cloud',
      message: `処理しています (${i + 1}/${count})`,
      args: { message, step: i },
    });
  }

  if (requiresApproval) {
    // 承認経路を通すための段。policy 側が EXTERNAL_COMMIT を承認必須と判定する。
    steps.push({
      index: count,
      toolId: 'noop.commit',
      risk: 'EXTERNAL_COMMIT',
      surface: 'cloud',
      message: '結果を確定します',
      args: { message },
    });
  }

  return {
    steps,
    artifact: {
      type: 'DOCUMENT',
      title: typeof input['title'] === 'string' ? input['title'] : 'Echo result',
      mimeType: 'text/markdown',
    },
  };
}

export function planTask(kind: string, input: Record<string, unknown>): TaskPlan {
  switch (kind) {
    case 'echo':
      return planEcho(input);
    default:
      throw new UnknownTaskKindError(kind);
  }
}

/** 承認カードに出す内容。tool 名や JSON を含めない（正本 §9.3）。 */
export function approvalSummaryFor(step: TaskStep): {
  summary: string;
  details: { label: string; value: string }[];
} {
  return {
    summary: step.message,
    details: Object.entries(step.args)
      .filter(([, v]) => typeof v === 'string' || typeof v === 'number')
      .slice(0, 10)
      .map(([label, value]) => ({ label, value: String(value) })),
  };
}
