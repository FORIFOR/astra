/**
 * 手元の実行基盤の調整役。正本 §4.4・§16.1。
 *
 * サーバ側は**実行しない。**保持して、貸し出して、戻りを待つ。
 *
 *   - Dock を閉じても仕事は続く。閉じたのは窓であって、仕事ではない
 *   - 端末が落ちたら `PAUSED_HOST_OFFLINE`。**FAILED にしない**
 *   - 承認待ちだったものは、戻っても勝手に進めない
 *   - **運営側のモデルへ黙って乗り換えない**
 */
import {
  AstraError,
  HOST_OFFLINE_AFTER_MS,
  canAutoResume,
  stateFromHeartbeat,
  uuidv7,
  type HostState,
} from '@astra/contracts';
import { withTenant, type DbHandle } from '@astra/db';

export interface AgentHostDeps {
  readonly db: DbHandle;
  readonly now?: () => Date;
  /** 貸し出しの有効期間。切れたら別の host が取り直せる。 */
  readonly leaseMs?: number;
}

/** 貸し出しの既定。heartbeat より長くしておく（瞬断で取り上げない）。 */
export const DEFAULT_LEASE_MS = 120_000;

export interface RegisteredHost {
  readonly id: string;
  readonly deviceLabel: string;
  readonly models: readonly string[];
  readonly lastSeenAt: string;
  readonly state: HostState;
}

export interface Lease {
  readonly taskId: string;
  readonly hostId: string;
  readonly leaseId: string;
  readonly expiresAt: string;
  readonly attempt: number;
}

export interface Checkpoint {
  readonly taskId: string;
  readonly stepIndex: number;
  readonly state: Record<string, unknown>;
  readonly updatedAt: string;
}

export class AgentHostService {
  readonly #db: DbHandle;
  readonly #now: () => Date;
  readonly #leaseMs: number;

  constructor(deps: AgentHostDeps) {
    this.#db = deps.db;
    this.#now = deps.now ?? (() => new Date());
    this.#leaseMs = deps.leaseMs ?? DEFAULT_LEASE_MS;
  }

  /**
   * 名乗る / 生きていることを伝える。
   *
   * **同じ端末を二重に登録しない。**入れ直しても同じ行を更新する。
   */
  async heartbeat(input: {
    tenantId: string;
    userId: string;
    deviceLabel: string;
    models: readonly string[];
    capabilities?: Record<string, unknown>;
  }): Promise<RegisteredHost> {
    const at = this.#now();
    const row = await withTenant(this.#db, input.tenantId, (tx) =>
      tx
        .insertInto('agent_hosts')
        .values({
          id: uuidv7(),
          tenant_id: input.tenantId,
          user_id: input.userId,
          device_label: input.deviceLabel,
          models: [...input.models],
          capabilities: JSON.stringify(input.capabilities ?? {}),
          last_seen_at: at,
          updated_at: at,
        })
        .onConflict((oc) =>
          oc.columns(['tenant_id', 'user_id', 'device_label']).doUpdateSet({
            models: [...input.models],
            capabilities: JSON.stringify(input.capabilities ?? {}),
            last_seen_at: at,
            updated_at: at,
          }),
        )
        .returningAll()
        .executeTakeFirstOrThrow(),
    );

    return {
      id: row.id,
      deviceLabel: row.device_label,
      models: row.models,
      lastSeenAt: row.last_seen_at.toISOString(),
      state: 'online',
    };
  }

  /** いまこの人の端末はどうなっているか。 */
  async hosts(tenantId: string, userId: string): Promise<RegisteredHost[]> {
    const now = this.#now().getTime();
    const rows = await withTenant(this.#db, tenantId, (tx) =>
      tx
        .selectFrom('agent_hosts')
        .selectAll()
        .where('user_id', '=', userId)
        .orderBy('last_seen_at', 'desc')
        .execute(),
    );
    return rows.map((row) => ({
      id: row.id,
      deviceLabel: row.device_label,
      models: row.models,
      lastSeenAt: row.last_seen_at.toISOString(),
      state: stateFromHeartbeat(row.last_seen_at.toISOString(), now),
    }));
  }

  /**
   * 仕事を借りる。
   *
   * **同じ仕事を二重に走らせない。**既に有効な貸し出しがあれば断る。
   * 切れているものだけ取り直せる。
   */
  async claim(input: { tenantId: string; taskId: string; hostId: string }): Promise<Lease> {
    const at = this.#now();
    const expiresAt = new Date(at.getTime() + this.#leaseMs);

    return withTenant(this.#db, input.tenantId, async (tx) => {
      const existing = await tx
        .selectFrom('job_leases')
        .selectAll()
        .where('task_id', '=', input.taskId)
        .executeTakeFirst();

      if (existing && existing.expires_at > at && existing.host_id !== input.hostId) {
        // 別の端末がまだ持っている。**取り上げない。**
        throw new AstraError('task.invalid_state', 'this job is already leased to another host');
      }

      const leaseId = uuidv7();
      const attempt = existing ? existing.attempt + 1 : 1;
      const row = await tx
        .insertInto('job_leases')
        .values({
          task_id: input.taskId,
          tenant_id: input.tenantId,
          host_id: input.hostId,
          lease_id: leaseId,
          expires_at: expiresAt,
          attempt,
          updated_at: at,
        })
        .onConflict((oc) =>
          oc.column('task_id').doUpdateSet({
            host_id: input.hostId,
            lease_id: leaseId,
            expires_at: expiresAt,
            attempt,
            updated_at: at,
          }),
        )
        .returningAll()
        .executeTakeFirstOrThrow();

      return {
        taskId: row.task_id,
        hostId: row.host_id,
        leaseId: row.lease_id,
        expiresAt: row.expires_at.toISOString(),
        attempt: row.attempt,
      };
    });
  }

  /** 借り続ける。**古い lease では延ばせない。** */
  async renew(input: { tenantId: string; taskId: string; leaseId: string }): Promise<Lease> {
    const at = this.#now();
    const expiresAt = new Date(at.getTime() + this.#leaseMs);
    const row = await withTenant(this.#db, input.tenantId, (tx) =>
      tx
        .updateTable('job_leases')
        .set({ expires_at: expiresAt, updated_at: at })
        .where('task_id', '=', input.taskId)
        .where('lease_id', '=', input.leaseId)
        .returningAll()
        .executeTakeFirst(),
    );
    if (!row) {
      // 取り上げられたあとの書き込みを通さない
      throw new AstraError('task.invalid_state', 'this lease is no longer valid');
    }
    return {
      taskId: row.task_id,
      hostId: row.host_id,
      leaseId: row.lease_id,
      expiresAt: row.expires_at.toISOString(),
      attempt: row.attempt,
    };
  }

  /** 返す。終わったか、諦めたか。 */
  async release(input: { tenantId: string; taskId: string; leaseId: string }): Promise<void> {
    await withTenant(this.#db, input.tenantId, (tx) =>
      tx
        .deleteFrom('job_leases')
        .where('task_id', '=', input.taskId)
        .where('lease_id', '=', input.leaseId)
        .execute(),
    );
  }

  /** その lease でいま書いてよいか。**古い host の書き込みを弾く唯一の門。** */
  async isLeaseValid(tenantId: string, taskId: string, leaseId: string): Promise<boolean> {
    const at = this.#now();
    const row = await withTenant(this.#db, tenantId, (tx) =>
      tx
        .selectFrom('job_leases')
        .select(['lease_id', 'expires_at'])
        .where('task_id', '=', taskId)
        .executeTakeFirst(),
    );
    return row !== undefined && row.lease_id === leaseId && row.expires_at > at;
  }

  /** 途中経過を残す。**上書きしていく**（履歴は要らない）。 */
  async checkpoint(input: {
    tenantId: string;
    taskId: string;
    leaseId: string;
    stepIndex: number;
    state: Record<string, unknown>;
  }): Promise<void> {
    if (!(await this.isLeaseValid(input.tenantId, input.taskId, input.leaseId))) {
      // 取り上げられた host が、あとから上書きしてくるのを防ぐ
      throw new AstraError('task.invalid_state', 'this lease is no longer valid');
    }
    const at = this.#now();
    await withTenant(this.#db, input.tenantId, (tx) =>
      tx
        .insertInto('job_checkpoints')
        .values({
          task_id: input.taskId,
          tenant_id: input.tenantId,
          step_index: input.stepIndex,
          state: JSON.stringify(input.state),
          updated_at: at,
        })
        .onConflict((oc) =>
          oc.column('task_id').doUpdateSet({
            step_index: input.stepIndex,
            state: JSON.stringify(input.state),
            updated_at: at,
          }),
        )
        .execute(),
    );
  }

  async lastCheckpoint(tenantId: string, taskId: string): Promise<Checkpoint | null> {
    const row = await withTenant(this.#db, tenantId, (tx) =>
      tx.selectFrom('job_checkpoints').selectAll().where('task_id', '=', taskId).executeTakeFirst(),
    );
    return row
      ? {
          taskId: row.task_id,
          stepIndex: row.step_index,
          state: row.state as Record<string, unknown>,
          updatedAt: row.updated_at.toISOString(),
        }
      : null;
  }

  /**
   * 端末が落ちた仕事を止める。
   *
   * **FAILED にしない。**待てば戻る。失敗にすると、
   * 利用者は最初からやり直すことになる。
   */
  async pauseOrphaned(tenantId: string): Promise<string[]> {
    const at = this.#now();
    const cutoff = new Date(at.getTime() - HOST_OFFLINE_AFTER_MS);

    return withTenant(this.#db, tenantId, async (tx) => {
      const orphaned = await tx
        .selectFrom('job_leases as l')
        .innerJoin('agent_hosts as h', 'h.id', 'l.host_id')
        .innerJoin('tasks as t', 't.id', 'l.task_id')
        .select(['l.task_id', 't.status'])
        .where('h.last_seen_at', '<', cutoff)
        .where('t.status', 'in', ['RUNNING', 'PENDING'])
        .execute();

      const paused: string[] = [];
      for (const row of orphaned) {
        await tx
          .updateTable('tasks')
          .set({ status: 'PAUSED_HOST_OFFLINE', updated_at: at })
          .where('id', '=', row.task_id)
          .where('status', 'in', ['RUNNING', 'PENDING'])
          .execute();
        paused.push(row.task_id);
      }
      return paused;
    });
  }

  /**
   * 戻ってきた仕事を動かし直す。
   *
   * **承認待ちだったものは進めない。**止まっている間に前提が変わっている。
   */
  async resume(input: {
    tenantId: string;
    taskId: string;
    hostId: string;
    wasWaitingApproval: boolean;
  }): Promise<{ resumed: boolean; reason: string | null }> {
    if (!canAutoResume('host_offline', input.wasWaitingApproval)) {
      return { resumed: false, reason: '確認待ちのままです。人の確認が要ります。' };
    }
    const at = this.#now();
    const updated = await withTenant(this.#db, input.tenantId, (tx) =>
      tx
        .updateTable('tasks')
        .set({ status: 'RUNNING', updated_at: at })
        .where('id', '=', input.taskId)
        .where('status', '=', 'PAUSED_HOST_OFFLINE')
        .executeTakeFirst(),
    );
    return Number(updated.numUpdatedRows) > 0
      ? { resumed: true, reason: null }
      : { resumed: false, reason: 'この仕事は止まっていません。' };
  }
}
