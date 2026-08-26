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

export const KNOWN_TASK_KINDS = ['echo', 'research'] as const;
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

/**
 * Research。正本 §8.1 の流れを、UI/UX §13.1 が見せる 4 つの工程にまとめる。
 *
 * 工程は 4 つで固定なので**進捗率は本物**になる。
 * 各工程の中身（検索件数）は事前に決まらないので、それは detail 側で示す（§6.2）。
 */
function planResearch(input: Record<string, unknown>): TaskPlan {
  const question =
    typeof input['question'] === 'string' && input['question'].trim().length > 0
      ? input['question'].trim()
      : typeof input['message'] === 'string'
        ? input['message'].trim()
        : '';

  const steps: TaskStep[] = [
    {
      index: 0,
      toolId: 'research.plan',
      risk: 'READ',
      surface: 'cloud',
      message: '調べることを整理しています',
      args: { question },
    },
    {
      index: 1,
      toolId: 'research.search',
      risk: 'READ',
      surface: 'cloud',
      message: '公式資料と最新ニュースを照合中',
      args: { question },
    },
    {
      index: 2,
      toolId: 'research.verify',
      risk: 'READ',
      surface: 'cloud',
      message: '食い違いを確認しています',
      args: { question },
    },
    {
      index: 3,
      toolId: 'research.report',
      risk: 'READ',
      surface: 'cloud',
      message: 'レポートを作成しています',
      args: { question },
    },
  ];

  return {
    steps,
    artifact: { type: 'REPORT', title: question || '調査レポート', mimeType: 'text/markdown' },
  };
}

export function planTask(kind: string, input: Record<string, unknown>): TaskPlan {
  switch (kind) {
    case 'echo':
      return planEcho(input);
    case 'research':
      return planResearch(input);
    default:
      throw new UnknownTaskKindError(kind);
  }
}

export interface ApprovalCard {
  readonly summary: string;
  readonly details: { label: string; value: string }[];
  readonly impact: {
    readonly primary_action_label: string;
    readonly affected_count: number | null;
    readonly scope: 'internal' | 'external';
    readonly reversible: boolean;
    readonly recovery_note: string | null;
  };
}

/**
 * 承認カードに出す内容。tool 名や JSON を含めない（正本 §9.3）。
 *
 * 主ボタンの文言は「承認」ではなく**結果**を書く（UI/UX §14.1）。
 * クライアント側で組み立てられるようにサーバが影響範囲を持つ。
 */
export function approvalSummaryFor(step: TaskStep): ApprovalCard {
  const external =
    step.risk === 'EXTERNAL_COMMIT' ||
    step.risk === 'DESTRUCTIVE' ||
    step.risk === 'REGULATED' ||
    step.risk === 'FINANCIAL';
  const count = typeof step.args['count'] === 'number' ? step.args['count'] : null;

  return {
    summary: step.message,
    details: Object.entries(step.args)
      .filter(([, v]) => typeof v === 'string' || typeof v === 'number')
      .slice(0, 10)
      .map(([label, value]) => ({ label, value: String(value) })),
    impact: {
      primary_action_label: primaryActionLabel(step, count),
      affected_count: count,
      scope: external ? 'external' : 'internal',
      reversible: step.risk === 'REVERSIBLE_WRITE',
      recovery_note: step.risk === 'REVERSIBLE_WRITE' ? '実行後に取り消せます' : null,
    },
  };
}

function primaryActionLabel(step: TaskStep, count: number | null): string {
  const suffix = count === null ? '' : `${count}件`;
  switch (step.risk) {
    case 'DESTRUCTIVE':
      return suffix ? `${suffix}削除する` : '削除する';
    case 'FINANCIAL':
      return '注文を確定する';
    case 'REGULATED':
      return '記録を更新する';
    case 'EXTERNAL_COMMIT':
      return suffix ? `${suffix}実行する` : '実行する';
    default:
      return '実行する';
  }
}
