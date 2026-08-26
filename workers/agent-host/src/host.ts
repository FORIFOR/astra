/**
 * Local Agent Host。正本 §4.4・§16.1。
 *
 * **Dock とは別プロセス。**Dock を閉じても、ここは動き続ける。
 * 閉じたのは窓であって、仕事ではない。
 *
 * ここが持つのは:
 *   - 生きていることを伝える（heartbeat）
 *   - 仕事を借りて、走らせて、返す（lease）
 *   - 途中を残す（checkpoint）
 *
 * **持たないもの**:
 *   - 任意コマンドの実行口
 *   - 利用者の資格情報の読み出し（Claude Code のログインは Claude Code のもの）
 */
import { HOST_OFFLINE_AFTER_MS } from '@astra/contracts';

export interface HostTransport {
  heartbeat(input: { deviceLabel: string; models: readonly string[] }): Promise<{ id: string }>;
  claim(taskId: string, hostId: string): Promise<{ leaseId: string; attempt: number }>;
  renew(taskId: string, leaseId: string): Promise<void>;
  release(taskId: string, leaseId: string): Promise<void>;
  checkpoint(
    taskId: string,
    leaseId: string,
    stepIndex: number,
    state: Record<string, unknown>,
  ): Promise<void>;
}

/** その仕事を実際に走らせるもの。**Host は中身を知らない。** */
export interface JobRunner {
  run(input: {
    taskId: string;
    /** 途中から始めるための印。無ければ最初から。 */
    resumeFrom: number;
    /** 一段進むたびに呼ぶ。ここで checkpoint が残る。 */
    onStep(stepIndex: number, state: Record<string, unknown>): Promise<void>;
    /** まだ借りていられるか。**失っていたら止める。** */
    stillLeased(): boolean;
  }): Promise<void>;
}

export interface HostOptions {
  readonly deviceLabel: string;
  /** この端末で使えるモデル。**空なら仕事を受けない。** */
  readonly models: readonly string[];
  readonly transport: HostTransport;
  readonly runner: JobRunner;
  /** heartbeat の間隔。offline 判定より十分短くする。 */
  readonly heartbeatMs?: number;
  readonly now?: () => number;
  readonly onError?: (error: Error) => void;
}

/**
 * heartbeat の既定。**offline 判定の 1/3。**
 * 1 回落としただけで offline にされない余裕を持たせる。
 */
export const DEFAULT_HEARTBEAT_MS = Math.floor(HOST_OFFLINE_AFTER_MS / 3);

export class LocalAgentHost {
  readonly #options: HostOptions;
  #hostId: string | null = null;
  #timer: ReturnType<typeof setInterval> | null = null;
  /** いま抱えている仕事。**二重に走らせないための唯一の記録。** */
  readonly #running = new Map<string, string>();

  constructor(options: HostOptions) {
    this.#options = options;
  }

  get hostId(): string | null {
    return this.#hostId;
  }

  get runningTasks(): readonly string[] {
    return [...this.#running.keys()];
  }

  /** 名乗って、以後定期的に生きていることを伝える。 */
  async start(): Promise<string> {
    const { deviceLabel, models, transport } = this.#options;
    const registered = await transport.heartbeat({ deviceLabel, models });
    this.#hostId = registered.id;

    const interval = this.#options.heartbeatMs ?? DEFAULT_HEARTBEAT_MS;
    this.#timer = setInterval(() => {
      void transport.heartbeat({ deviceLabel, models }).catch((error: unknown) => {
        // 1 回落ちても止めない。続けて落ちれば、サーバ側が offline にする
        this.#options.onError?.(error instanceof Error ? error : new Error(String(error)));
      });
    }, interval);
    // Node を起こしたままにしない
    this.#timer.unref?.();

    return registered.id;
  }

  /**
   * 仕事を引き受ける。
   *
   * **同じ仕事を二度引き受けない。**引き受けているものは、
   * 借り直しの通知が来ても無視する。
   */
  async accept(taskId: string, resumeFrom = 0): Promise<{ accepted: boolean; reason?: string }> {
    if (this.#hostId === null) return { accepted: false, reason: 'この端末はまだ名乗っていません' };
    if (this.#options.models.length === 0) {
      // モデルが無いのに引き受けると、走り出してから失敗する
      return { accepted: false, reason: 'この端末で使えるモデルがありません' };
    }
    if (this.#running.has(taskId)) return { accepted: false, reason: 'すでに動いています' };

    const { leaseId } = await this.#options.transport.claim(taskId, this.#hostId);
    this.#running.set(taskId, leaseId);

    try {
      await this.#options.runner.run({
        taskId,
        resumeFrom,
        onStep: async (stepIndex, state) => {
          await this.#options.transport.checkpoint(taskId, leaseId, stepIndex, state);
          // 長い仕事の途中で貸し出しが切れないよう、進むたびに延ばす
          await this.#options.transport.renew(taskId, leaseId);
        },
        stillLeased: () => this.#running.get(taskId) === leaseId,
      });
      return { accepted: true };
    } finally {
      this.#running.delete(taskId);
      // 終わっても諦めても、借りたままにしない
      await this.#options.transport.release(taskId, leaseId).catch(() => undefined);
    }
  }

  /** 止める。**抱えている仕事は返す。** */
  async stop(): Promise<void> {
    if (this.#timer) clearInterval(this.#timer);
    this.#timer = null;
    for (const [taskId, leaseId] of this.#running) {
      await this.#options.transport.release(taskId, leaseId).catch(() => undefined);
    }
    this.#running.clear();
  }
}
