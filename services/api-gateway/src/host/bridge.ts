/**
 * Local Host Bridge。正本 §16.1・§21、実装仕様 §10。
 *
 * クラウド側は「どのデバイスが繋がっていて、何ができると申告したか」を持ち、
 * 呼び出しを転送する。**能力の最終判断はホスト側**にあり、ここでの検査は
 * 明らかに無駄な往復を減らすための一次フィルタでしかない（正本 §21）。
 */
import { AstraError, HOST_CALL_DEDUPE_WINDOW_MS, uuidv7, type ActionRisk } from '@astra/contracts';
import type { Logger } from '@astra/telemetry';

export interface HostSocket {
  send(data: string): void;
  close(code?: number, reason?: string): void;
}

interface Connection {
  readonly deviceId: string;
  readonly tenantId: string;
  readonly userId: string;
  readonly socket: HostSocket;
  capabilities: Set<string>;
  lastSeenAt: number;
  readonly pending: Map<string, PendingCall>;
  /** 直近に返した結果。同じ call_id の再送に同じ結果を返す（at-most-once）。 */
  readonly recent: Map<
    string,
    { at: number; value: unknown; error?: { code: string; message: string } }
  >;
}

interface PendingCall {
  resolve(value: unknown): void;
  reject(error: Error): void;
  timer: NodeJS.Timeout;
}

export interface HostCallOptions {
  readonly capability: string;
  readonly args?: unknown;
  readonly risk: ActionRisk;
  readonly taskId?: string;
  /** READ 以外はホスト側が承認済み ID を要求する（実装仕様 §10.3）。 */
  readonly approvalId?: string;
  readonly deadlineMs?: number;
}

export class HostBridge {
  readonly #byDevice = new Map<string, Connection>();
  readonly #logger: Logger | undefined;
  readonly #now: () => number;

  constructor(options: { logger?: Logger; now?: () => number } = {}) {
    this.#logger = options.logger;
    this.#now = options.now ?? (() => Date.now());
  }

  /**
   * 接続を登録する。同じ device の古い接続は切る。
   * 1 device 1 接続にしないと、呼び出しがどちらへ届いたか分からなくなる。
   */
  attach(params: { deviceId: string; tenantId: string; userId: string; socket: HostSocket }): void {
    const previous = this.#byDevice.get(params.deviceId);
    if (previous) {
      this.#failAllPending(previous, 'replaced by a newer connection');
      previous.socket.close(4000, 'replaced');
    }
    this.#byDevice.set(params.deviceId, {
      deviceId: params.deviceId,
      tenantId: params.tenantId,
      userId: params.userId,
      socket: params.socket,
      capabilities: new Set(),
      lastSeenAt: this.#now(),
      pending: new Map(),
      recent: new Map(),
    });
  }

  detach(deviceId: string, socket?: HostSocket): void {
    const connection = this.#byDevice.get(deviceId);
    if (!connection) return;
    // 差し替え済みの古い socket からの切断通知で新しい接続を消さない
    if (socket && connection.socket !== socket) return;
    this.#failAllPending(connection, 'host disconnected');
    this.#byDevice.delete(deviceId);
  }

  /** hello を受けて能力集合を確定する。以降これに無い capability は送らない。 */
  declareCapabilities(deviceId: string, capabilities: readonly string[]): void {
    const connection = this.#require(deviceId);
    connection.capabilities = new Set(capabilities);
    connection.lastSeenAt = this.#now();
  }

  isConnected(deviceId: string): boolean {
    return this.#byDevice.has(deviceId);
  }

  capabilitiesOf(deviceId: string): string[] {
    return [...this.#require(deviceId).capabilities];
  }

  touch(deviceId: string): void {
    const connection = this.#byDevice.get(deviceId);
    if (connection) connection.lastSeenAt = this.#now();
  }

  /** 無応答の接続を切る。呼び出し側が定期的に回す。 */
  reapStale(timeoutMs: number): string[] {
    const dead: string[] = [];
    for (const [deviceId, connection] of this.#byDevice) {
      if (this.#now() - connection.lastSeenAt > timeoutMs) {
        connection.socket.close(4001, 'heartbeat timeout');
        this.#failAllPending(connection, 'heartbeat timeout');
        this.#byDevice.delete(deviceId);
        dead.push(deviceId);
      }
    }
    return dead;
  }

  /**
   * ホストへ呼び出しを送る。
   *
   * **タイムアウトしても再試行しない**（実装仕様 §10.4）。ホスト側で副作用が
   * 起きたかどうか分からない以上、勝手に二重実行させない。再試行は上位の
   * workflow が明示的に判断する。
   */
  async call(deviceId: string, options: HostCallOptions): Promise<unknown> {
    const connection = this.#byDevice.get(deviceId);
    if (!connection) {
      throw new AstraError('host.not_connected', `device ${deviceId} is not connected`);
    }
    if (!connection.capabilities.has(options.capability)) {
      // ホスト側でも同じ検査をする。ここは往復を省くための一次フィルタ。
      throw new AstraError(
        'host.capability_denied',
        `device ${deviceId} did not declare ${options.capability}`,
      );
    }
    if (options.risk !== 'READ' && !options.approvalId) {
      throw new AstraError(
        'host.capability_denied',
        `${options.capability} is ${options.risk} and requires an approved decision`,
      );
    }

    const callId = uuidv7();
    const deadlineMs = options.deadlineMs ?? 10_000;

    const result = new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        connection.pending.delete(callId);
        reject(new AstraError('host.timeout', `${options.capability} timed out`));
      }, deadlineMs);
      connection.pending.set(callId, { resolve, reject, timer });
    });

    connection.socket.send(
      JSON.stringify({
        type: 'host.call',
        call_id: callId,
        capability: options.capability,
        args: options.args ?? {},
        ...(options.taskId ? { task_id: options.taskId } : {}),
        risk: options.risk,
        ...(options.approvalId ? { approval_id: options.approvalId } : {}),
        deadline_ms: deadlineMs,
      }),
    );

    return result;
  }

  /** ホストからの結果を配る。未知の call_id は静かに捨てる（再送や取り違え）。 */
  settle(
    deviceId: string,
    callId: string,
    outcome: { ok: true; value: unknown } | { ok: false; error: { code: string; message: string } },
  ): void {
    const connection = this.#byDevice.get(deviceId);
    if (!connection) return;
    connection.lastSeenAt = this.#now();

    this.#pruneRecent(connection);
    connection.recent.set(callId, {
      at: this.#now(),
      value: outcome.ok ? outcome.value : undefined,
      ...(outcome.ok ? {} : { error: outcome.error }),
    });

    const pending = connection.pending.get(callId);
    if (!pending) {
      this.#logger?.debug({ device_id: deviceId, call_id: callId }, 'result for an unknown call');
      return;
    }
    connection.pending.delete(callId);
    clearTimeout(pending.timer);

    if (outcome.ok) pending.resolve(outcome.value);
    else pending.reject(new AstraError('host.capability_denied', outcome.error.message));
  }

  #pruneRecent(connection: Connection): void {
    const cutoff = this.#now() - HOST_CALL_DEDUPE_WINDOW_MS;
    for (const [callId, entry] of connection.recent) {
      if (entry.at < cutoff) connection.recent.delete(callId);
    }
  }

  #failAllPending(connection: Connection, reason: string): void {
    for (const [, pending] of connection.pending) {
      clearTimeout(pending.timer);
      pending.reject(new AstraError('host.not_connected', reason));
    }
    connection.pending.clear();
  }

  #require(deviceId: string): Connection {
    const connection = this.#byDevice.get(deviceId);
    if (!connection) {
      throw new AstraError('host.not_connected', `device ${deviceId} is not connected`);
    }
    return connection;
  }
}
