/**
 * イベント列から「仕事の進行」を組み立てる。UI/UX §6。
 *
 * ここが UI-2 の要。Agent の編成や tool 呼び出しを見せず、
 * **ユーザーの仕事の単位**で表現する（§1.2 Show Work, Not Agents）。
 *
 * 表示する / しない（§6.1）:
 *   「競合情報を調査中」  ← ResearchAgent #3 running   ではなく
 *   「12 sources」        ← crawler worker count       ではなく
 *   「確認待ち」          ← workflow waiting activity  ではなく
 */
import type { EventEnvelope, TaskStatus } from '@astra/contracts';

export type StepState = 'todo' | 'active' | 'done' | 'retrying' | 'failed';

export interface WorkStep {
  readonly index: number;
  readonly state: StepState;
  /** ユーザーに見せる自然文。tool 名を出さない。 */
  readonly label: string;
  /** 「12 sources」のような補助表示（§6.1）。 */
  readonly detail: string | null;
  /** §9.2 Progress は timestamps を要求する。分からなければ null。 */
  readonly startedAt: string | null;
  readonly endedAt: string | null;
}

export interface WorkAttention {
  readonly kind: 'approval';
  readonly approvalId: string;
  readonly summary: string;
  /** §14.1: 主ボタンは「承認」ではなく結果を書く。 */
  readonly primaryActionLabel: string;
  readonly expiresAt: string;
}

export interface WorkView {
  readonly title: string | null;
  readonly status: TaskStatus | 'UNKNOWN';
  readonly steps: readonly WorkStep[];
  /**
   * 進捗率。**真の進行率を計算できるときだけ**入る（§6.2）。
   * 段数が決まらない処理では null のままにして、推定 % を出さない。
   */
  readonly percent: number | null;
  /** 承認待ち。進捗と混ぜず、別の attention state として扱う（§6.2）。 */
  readonly attention: WorkAttention | null;
  readonly resultArtifactId: string | null;
  readonly error: { code: string; recovery: string } | null;
  readonly elapsedMs: number | null;
  /** 始まった時刻 / 終わった時刻。§9.2 Progress の timestamps。 */
  readonly startedAt: string | null;
  readonly endedAt: string | null;
  readonly lastSequence: number;
}

export const emptyWorkView: WorkView = {
  title: null,
  status: 'UNKNOWN',
  steps: [],
  percent: null,
  attention: null,
  resultArtifactId: null,
  error: null,
  elapsedMs: null,
  startedAt: null,
  endedAt: null,
  lastSequence: 0,
};

interface Mutable {
  title: string | null;
  status: WorkView['status'];
  steps: Map<number, WorkStep>;
  stepCount: number | null;
  attention: WorkAttention | null;
  resultArtifactId: string | null;
  error: WorkView['error'];
  elapsedMs: number | null;
  startedAt: string | null;
  endedAt: string | null;
  lastSequence: number;
}

function seed(view: WorkView): Mutable {
  return {
    title: view.title,
    status: view.status,
    steps: new Map(view.steps.map((s) => [s.index, s])),
    stepCount: view.percent === null ? null : view.steps.length,
    attention: view.attention,
    resultArtifactId: view.resultArtifactId,
    error: view.error,
    elapsedMs: view.elapsedMs,
    startedAt: view.startedAt,
    endedAt: view.endedAt,
    lastSequence: view.lastSequence,
  };
}

function upsert(draft: Mutable, index: number, patch: Partial<WorkStep>): void {
  const current = draft.steps.get(index) ?? {
    index,
    state: 'todo' as StepState,
    label: '',
    detail: null,
    startedAt: null,
    endedAt: null,
  };
  draft.steps.set(index, { ...current, ...patch });
}

/** 1 イベントを畳み込む。同じイベントを 2 回渡しても結果は変わらない。 */
export function applyEvent(view: WorkView, event: EventEnvelope): WorkView {
  // 既に取り込んだ番号は無視する（再接続の境界で重複し得る）
  if (event.sequence <= view.lastSequence) return view;

  const draft = seed(view);
  draft.lastSequence = event.sequence;

  switch (event.type) {
    case 'task.started': {
      draft.title = event.payload.title;
      draft.status = 'RUNNING';
      draft.startedAt = event.timestamp;
      draft.stepCount = event.payload.step_count;
      if (event.payload.step_count !== null) {
        for (let i = 0; i < event.payload.step_count; i += 1) {
          upsert(draft, i, { state: 'todo', label: '' });
        }
      }
      break;
    }
    case 'tool.started': {
      upsert(draft, event.payload.step_index, {
        state: 'active',
        startedAt: event.timestamp,
      });
      break;
    }
    case 'tool.completed': {
      upsert(draft, event.payload.step_index, {
        state: event.payload.ok ? 'done' : 'failed',
        endedAt: event.timestamp,
      });
      break;
    }
    case 'task.progress': {
      const index = event.payload.step_index ?? draft.steps.size;
      const known = draft.steps.get(index);
      upsert(draft, index, {
        // §6.2: retry 中は失敗として固定せず「再試行中」に置き換える
        state: event.payload.retrying ? 'retrying' : 'active',
        label: event.payload.message,
        detail: event.payload.detail,
        // 最初に動いた時刻を残す。進捗のたびに上書きすると開始時刻を失う。
        startedAt: known?.startedAt ?? event.timestamp,
      });
      if (event.payload.step_count !== null) draft.stepCount = event.payload.step_count;
      if (event.payload.elapsed_ms !== null) draft.elapsedMs = event.payload.elapsed_ms;
      break;
    }
    case 'task.waiting_approval': {
      draft.status = 'WAITING_APPROVAL';
      draft.attention = {
        kind: 'approval',
        approvalId: event.payload.approval_id,
        summary: event.payload.summary,
        primaryActionLabel: event.payload.primary_action_label,
        expiresAt: event.payload.expires_at,
      };
      break;
    }
    case 'artifact.created': {
      draft.resultArtifactId = event.payload.artifact_id;
      break;
    }
    case 'task.completed': {
      draft.status = 'COMPLETED';
      draft.attention = null;
      draft.resultArtifactId = event.payload.result_artifact_id ?? draft.resultArtifactId;
      draft.elapsedMs = event.payload.duration_ms;
      draft.endedAt = event.timestamp;
      for (const [index, step] of draft.steps) {
        if (step.state !== 'done') {
          draft.steps.set(index, {
            ...step,
            state: 'done',
            endedAt: step.endedAt ?? event.timestamp,
          });
        }
      }
      break;
    }
    case 'task.failed': {
      draft.status = 'FAILED';
      draft.attention = null;
      draft.error = { code: event.payload.error.code, recovery: event.payload.error.recovery };
      draft.endedAt = event.timestamp;
      for (const [index, step] of draft.steps) {
        if (step.state === 'active' || step.state === 'retrying') {
          draft.steps.set(index, { ...step, state: 'failed', endedAt: event.timestamp });
        }
      }
      break;
    }
    case 'task.cancelled': {
      draft.status = 'CANCELLED';
      draft.attention = null;
      draft.endedAt = event.timestamp;
      break;
    }
    default:
      // 未知の型は状態を変えない。sequence だけ進める（実装仕様 §3.8）。
      break;
  }

  const steps = [...draft.steps.values()].sort((a, b) => a.index - b.index);
  const done = steps.filter((s) => s.state === 'done').length;

  return {
    title: draft.title,
    status: draft.status,
    steps,
    // §6.2: 段数が分かるときだけ % を出す。推定 % を乱用しない。
    percent:
      draft.stepCount && draft.stepCount > 0 ? Math.round((done / draft.stepCount) * 100) : null,
    attention: draft.attention,
    resultArtifactId: draft.resultArtifactId,
    error: draft.error,
    elapsedMs: draft.elapsedMs,
    startedAt: draft.startedAt,
    endedAt: draft.endedAt,
    lastSequence: draft.lastSequence,
  };
}

export function applyEvents(view: WorkView, events: readonly EventEnvelope[]): WorkView {
  return events.reduce(applyEvent, view);
}

/** 経過時間の表示。分未満は秒で出す。 */
export function formatElapsed(ms: number | null): string | null {
  if (ms === null) return null;
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}秒`;
  const minutes = Math.floor(seconds / 60);
  return seconds % 60 === 0 ? `${minutes}分` : `${minutes}分${seconds % 60}秒`;
}
