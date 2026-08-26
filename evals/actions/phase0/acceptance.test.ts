/**
 * Phase 0 受け入れテスト。実装仕様 §16 の AC-1〜AC-16。
 *
 *   pnpm test:acceptance
 *
 * 正本 §28 Phase 0 Exit「create task → progress → result artifact」を
 * **HTTP から**検証する。ここが green であることが Phase 0 完了の唯一の判定。
 */
import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Writable } from 'node:stream';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { TestWorkflowEnvironment } from '@temporalio/testing';
import type { Worker } from '@temporalio/worker';
import {
  HOST_PROTOCOL,
  PROGRESS_HEARTBEAT_MAX_MS,
  uuidv7,
  type ApiError,
  type Artifact,
  type PluginCatalogEntry,
  type Task,
  type TokenResponse,
} from '@astra/contracts';
import { createDb, withTenant, type DbHandle } from '@astra/db';
import { createLogger, readAuditChain, verifyAuditChain } from '@astra/telemetry';
import { FsObjectStore, LibraryService } from '@astra/service-library';
import { PluginRegistryService } from '@astra/service-plugin-registry';
import {
  TaskService,
  TemporalTaskRuntime,
  createTaskWorker,
  workflowIdFor,
} from '@astra/service-task';
import { parseManifest } from '@astra/plugin-sdk';
import {
  HostBridge,
  MemoryRateLimiter,
  buildApp,
  JwtTokens,
  loadSigningKeys,
  type App,
} from '@astra/service-api-gateway';

const url = process.env['TEST_DATABASE_URL'];
const identityUrl = process.env['TEST_IDENTITY_DATABASE_URL'];
const repoRoot = fileURLToPath(new URL('../../..', import.meta.url));
const TASK_QUEUE = 'astra.task.acceptance';

const sink = new Writable({
  write(_c, _e, cb) {
    cb();
  },
});

interface Session {
  readonly tokens: TokenResponse;
  readonly auth: { authorization: string };
  readonly tenantId: string;
  readonly userId: string;
  readonly deviceId: string;
}

describe.skipIf(!url)('Phase 0 acceptance', () => {
  let env: TestWorkflowEnvironment;
  let worker: Worker;
  let workerRun: Promise<void>;
  let db: DbHandle;
  let app: App;
  let bridge: HostBridge;
  let library: LibraryService;
  let storeRoot: string;
  let baseUrl: string;
  let me: Session;
  let other: Session;

  const signIn = async (): Promise<Session> => {
    const issued = await app.inject({
      method: 'POST',
      url: '/v1/auth/dev/token',
      payload: { email: `ac-${uuidv7()}@example.com`, display_name: 'Acceptance' },
    });
    expect(issued.statusCode).toBe(200);
    const tokens = issued.json<TokenResponse>();
    const auth = { authorization: `Bearer ${tokens.access_token}` };
    const profile = await app.inject({ method: 'GET', url: '/v1/me', headers: auth });
    const body = profile.json<{
      tenant: { id: string };
      user: { id: string };
      device: { id: string };
    }>();
    return {
      tokens,
      auth,
      tenantId: body.tenant.id,
      userId: body.user.id,
      deviceId: body.device.id,
    };
  };

  const createTask = async (
    input: Record<string, unknown>,
    key = `ac-${uuidv7()}`,
  ): Promise<{ task: Task; status: number; key: string }> => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/tasks',
      headers: { ...me.auth, 'idempotency-key': key },
      payload: { kind: 'echo', input },
    });
    return { task: res.json<Task>(), status: res.statusCode, key };
  };

  const waitForWorkflow = (taskId: string): Promise<unknown> =>
    env.client.workflow.getHandle(workflowIdFor(me.tenantId, taskId)).result();

  const readStream = async (
    taskId: string,
    lastEventId?: number,
  ): Promise<{ id: number; event: string; data: Record<string, unknown> }[]> => {
    const res = await app.inject({
      method: 'GET',
      url: `/v1/tasks/${taskId}/stream`,
      headers: {
        ...me.auth,
        ...(lastEventId === undefined ? {} : { 'last-event-id': String(lastEventId) }),
      },
    });
    expect(res.statusCode).toBe(200);
    return res.body
      .split('\n\n')
      .filter((block) => block.startsWith('id: '))
      .map((block) => ({
        id: Number(/^id: (\d+)/.exec(block)![1]),
        event: /event: (.+)/.exec(block)![1]!,
        data: JSON.parse(/data: (.+)/.exec(block)![1]!) as Record<string, unknown>,
      }));
  };

  const waitForApproval = async (taskId: string): Promise<string> => {
    for (let i = 0; i < 100; i += 1) {
      const row = await withTenant(db, me.tenantId, (tx) =>
        tx
          .selectFrom('approvals')
          .select(['id'])
          .where('task_id', '=', taskId)
          .where('status', '=', 'PENDING')
          .executeTakeFirst(),
      );
      if (row) return row.id;
      await new Promise((r) => setTimeout(r, 50));
    }
    throw new Error(`no approval appeared for ${taskId}`);
  };

  beforeAll(async () => {
    db = createDb({
      url: url!,
      identityUrl,
      maxConnections: 12,
      identityMaxConnections: 3,
      idleTimeoutMillis: 5_000,
      connectionTimeoutMillis: 5_000,
      statementTimeoutMillis: 20_000,
      applicationName: 'astra-acceptance',
    });

    storeRoot = await mkdtemp(path.join(tmpdir(), 'astra-acceptance-'));
    library = new LibraryService(db, new FsObjectStore(storeRoot));

    env = await TestWorkflowEnvironment.createLocal();
    worker = await createTaskWorker(
      { db, library, publisher: { async publish() {} } },
      {
        connection: env.nativeConnection,
        namespace: env.client.options.namespace,
        taskQueue: TASK_QUEUE,
        workflowsPath: path.join(repoRoot, 'services/task/src/workflows.ts'),
      },
    );
    workerRun = worker.run();

    const registry = new PluginRegistryService({ db, coreVersion: '0.1.0' });
    await registry.seedBuiltins(path.join(repoRoot, 'plugins/builtin'));
    bridge = new HostBridge();

    app = buildApp({
      config: {
        env: 'test',
        port: 0,
        host: '127.0.0.1',
        logLevel: 'silent',
        redisUrl: undefined,
        version: '0.1.0',
        db: {
          url: url!,
          identityUrl,
          maxConnections: 12,
          identityMaxConnections: 3,
          idleTimeoutMillis: 5_000,
          connectionTimeoutMillis: 5_000,
          statementTimeoutMillis: 20_000,
          applicationName: 'astra-acceptance',
        },
        builtinPluginsDir: path.join(repoRoot, 'plugins/builtin'),
        objectStoreRoot: storeRoot,
        recordingRoot: storeRoot,
        allowedOrigins: [],
        shareHost: 'http://localhost:1430',
        requesterSalt: 'acceptance-salt',
      },
      db,
      redis: null,
      rateLimiter: new MemoryRateLimiter(),
      logger: createLogger({ service: 'acceptance', level: 'silent' }, sink),
      tokens: new JwtTokens({
        issuer: 'https://auth.astra.test',
        keys: await loadSigningKeys({ keyId: 'acceptance' }),
      }),
      tasks: new TaskService(db, new TemporalTaskRuntime(env.client, TASK_QUEUE)),
      library,
      registry,
      bridge,
      ssePollIntervalMs: 20,
    });
    await app.listen({ port: 0, host: '127.0.0.1' });
    const address = app.server.address();
    baseUrl = `ws://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;

    me = await signIn();
    other = await signIn();
  }, 180_000);

  afterAll(async () => {
    worker?.shutdown();
    await workerRun?.catch(() => undefined);
    await app?.close();
    await env?.teardown();
    await db?.close();
    if (storeRoot) await rm(storeRoot, { recursive: true, force: true });
  }, 60_000);

  it('AC-1: issues tokens and provisions a tenant', () => {
    expect(me.tokens.token_type).toBe('Bearer');
    expect(me.tenantId).toMatch(/^[0-9a-f-]{36}$/);
    expect(other.tenantId).not.toBe(me.tenantId);
  });

  describe('AC-2 … AC-8: create task → progress → artifact', () => {
    let taskId: string;
    let key: string;
    let events: { id: number; event: string; data: Record<string, unknown> }[];

    beforeAll(async () => {
      const created = await createTask({ message: 'acceptance run', steps: 3 });
      expect(created.status).toBe(202); // AC-2
      taskId = created.task.id;
      key = created.key;
      await waitForWorkflow(taskId);
      events = await readStream(taskId);
    }, 60_000);

    it('AC-3: the same idempotency key returns the same task and starts one workflow', async () => {
      const again = await createTask({ message: 'acceptance run', steps: 3 }, key);
      expect(again.status).toBe(200);
      expect(again.task.id).toBe(taskId);
      expect(events.filter((e) => e.event === 'task.started')).toHaveLength(1);
    });

    it('AC-4: the stream is ordered and gapless from 1 to N', () => {
      expect(events.map((e) => e.id)).toEqual(events.map((_, i) => i + 1));
      const types = events.map((e) => e.event);
      expect(types[0]).toBe('task.started');
      expect(types.at(-1)).toBe('task.completed');
      expect(types.filter((t) => t === 'task.progress')).toHaveLength(3);
      expect(types.indexOf('artifact.created')).toBeLessThan(types.indexOf('task.completed'));
    });

    it('AC-5: resuming from Last-Event-ID loses and repeats nothing', async () => {
      const tail = await readStream(taskId, 3);
      expect(tail.map((e) => e.id)).toEqual(events.slice(3).map((e) => e.id));
      const seen = new Set([...events.slice(0, 3), ...tail].map((e) => e.id));
      expect(seen.size).toBe(events.length);
    });

    it('AC-6: no gap between events exceeds the 2s progress budget', () => {
      const stamps = events.map((e) => new Date(String(e.data['timestamp'])).getTime());
      for (let i = 1; i < stamps.length; i += 1) {
        expect(stamps[i]! - stamps[i - 1]!).toBeLessThanOrEqual(PROGRESS_HEARTBEAT_MAX_MS);
      }
    });

    it('AC-7: the artifact holds the input and its recorded sha256 matches', async () => {
      const task = (
        await app.inject({ method: 'GET', url: `/v1/tasks/${taskId}`, headers: me.auth })
      ).json<Task>();
      expect(task.status).toBe('COMPLETED');
      expect(task.result_artifact_id).not.toBeNull();

      const meta = (
        await app.inject({
          method: 'GET',
          url: `/v1/artifacts/${task.result_artifact_id}`,
          headers: me.auth,
        })
      ).json<Artifact>();
      const content = await app.inject({
        method: 'GET',
        url: `/v1/artifacts/${task.result_artifact_id}/content`,
        headers: me.auth,
      });
      expect(content.body).toContain('acceptance run');
      expect(createHash('sha256').update(content.rawPayload).digest('hex')).toBe(meta.sha256);
    });

    it('AC-8: another tenant gets 404, not 403', async () => {
      for (const target of [`/v1/tasks/${taskId}`, `/v1/tasks/${taskId}/stream`]) {
        const res = await app.inject({ method: 'GET', url: target, headers: other.auth });
        expect(res.statusCode).toBe(404);
      }
      const task = (
        await app.inject({ method: 'GET', url: `/v1/tasks/${taskId}`, headers: me.auth })
      ).json<Task>();
      const artifact = await app.inject({
        method: 'GET',
        url: `/v1/artifacts/${task.result_artifact_id}`,
        headers: other.auth,
      });
      expect(artifact.statusCode).toBe(404);
      expect(artifact.json<ApiError>().error.code).toBe('artifact.not_found');
    });
  });

  describe('AC-9 … AC-11: approval and cancellation', () => {
    it('AC-9: approval resumes the task and leaves a receipt naming the approver', async () => {
      const { task } = await createTask({ message: 'approve', require_approval: true });
      const approvalId = await waitForApproval(task.id);

      const waiting = (
        await app.inject({ method: 'GET', url: `/v1/tasks/${task.id}`, headers: me.auth })
      ).json<Task & { dock_state: string }>();
      expect(waiting.status).toBe('WAITING_APPROVAL');
      expect(waiting.dock_state).toBe('WAITING_APPROVAL');

      const decided = await app.inject({
        method: 'POST',
        url: `/v1/tasks/${task.id}/approve`,
        headers: me.auth,
        payload: { approval_id: approvalId, decision: 'APPROVED' },
      });
      expect(decided.statusCode).toBe(204);
      await waitForWorkflow(task.id);

      const done = (
        await app.inject({ method: 'GET', url: `/v1/tasks/${task.id}`, headers: me.auth })
      ).json<Task>();
      expect(done.status).toBe('COMPLETED');

      const receipts = await withTenant(db, me.tenantId, (tx) =>
        tx
          .selectFrom('action_receipts')
          .selectAll()
          .where('task_id', '=', task.id)
          .where('risk', '=', 'EXTERNAL_COMMIT')
          .execute(),
      );
      expect(receipts).toHaveLength(1);
      expect(receipts[0]!.approved_by).toBe(me.userId);
    }, 60_000);

    it('AC-10: rejection cancels the task and leaves no external receipt', async () => {
      const { task } = await createTask({ message: 'reject', require_approval: true });
      const approvalId = await waitForApproval(task.id);
      await app.inject({
        method: 'POST',
        url: `/v1/tasks/${task.id}/approve`,
        headers: me.auth,
        payload: { approval_id: approvalId, decision: 'REJECTED' },
      });
      await waitForWorkflow(task.id);

      const done = (
        await app.inject({ method: 'GET', url: `/v1/tasks/${task.id}`, headers: me.auth })
      ).json<Task>();
      expect(done.status).toBe('CANCELLED');
      expect(done.result_artifact_id).toBeNull();

      const receipts = await withTenant(db, me.tenantId, (tx) =>
        tx
          .selectFrom('action_receipts')
          .selectAll()
          .where('task_id', '=', task.id)
          .where('risk', '=', 'EXTERNAL_COMMIT')
          .execute(),
      );
      expect(receipts).toEqual([]);
    }, 60_000);

    it('AC-11: cancel moves through CANCELLING and emits task.cancelled', async () => {
      const { task } = await createTask({ message: 'cancel me', require_approval: true });
      await waitForApproval(task.id);

      const cancelled = await app.inject({
        method: 'POST',
        url: `/v1/tasks/${task.id}/cancel`,
        headers: me.auth,
        payload: { reason: 'user_requested' },
      });
      expect(cancelled.statusCode).toBe(200);
      expect(cancelled.json<Task>().status).toBe('CANCELLING');
      await waitForWorkflow(task.id);

      const done = (
        await app.inject({ method: 'GET', url: `/v1/tasks/${task.id}`, headers: me.auth })
      ).json<Task>();
      expect(done.status).toBe('CANCELLED');
      expect((await readStream(task.id)).some((e) => e.event === 'task.cancelled')).toBe(true);
    }, 60_000);
  });

  describe('AC-12 … AC-14: plugins and the host bridge', () => {
    it('AC-12: all five bundled manifests are in the catalog', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/v1/plugins/catalog',
        headers: me.auth,
      });
      const items = res.json<{ items: PluginCatalogEntry[] }>().items;
      // 同梱の 5 つが載っていること。**完全一致では見ない**:
      // 同じ DB を使う別スイートが publish した plugin で壊れる。
      const ids = new Set(items.map((p) => p.id as string));
      expect([...ids].filter((id) => id.startsWith('com.astra.')).sort()).toEqual([
        'com.astra.finder',
        'com.astra.gmail',
        'com.astra.google-calendar',
        'com.astra.meeting',
        'com.astra.research',
      ]);
    });

    it('AC-13: a manifest that drops requires_confirmation is refused', () => {
      expect(() =>
        parseManifest(
          {
            id: 'com.example.bad',
            name: 'Bad',
            version: '1.0.0',
            publisher: 'example',
            min_core_version: '0.1.0',
            category: 'connector',
            compliance_profile: 'GENERAL',
            execution_surfaces: ['cloud'],
            data_accessed: ['x'],
            tools: [{ id: 'mail.send', risk: 'EXTERNAL_COMMIT' }],
          },
          'acceptance',
        ),
      ).toThrow(/invalid manifest/);
    });

    it('AC-14: host.ping succeeds and an undeclared capability is denied', async () => {
      const ws = new WebSocket(`${baseUrl}/v1/host/bridge`, [
        HOST_PROTOCOL,
        `bearer.${me.tokens.device_token}`,
      ]);
      await new Promise<void>((resolve, reject) => {
        ws.once('open', () => resolve());
        ws.once('error', reject);
      });
      ws.on('message', (raw) => {
        const frame = JSON.parse(String(raw)) as { type: string; call_id?: string };
        if (frame.type === 'host.call') {
          ws.send(
            JSON.stringify({
              type: 'host.result',
              call_id: frame.call_id,
              ok: true,
              value: { pong: true },
            }),
          );
        }
      });
      ws.send(
        JSON.stringify({
          type: 'host.hello',
          device_id: me.deviceId,
          app_version: '0.1.0',
          platform: 'macos',
          capabilities: ['host.ping', 'host.system.info'],
        }),
      );
      for (let i = 0; i < 100 && !bridge.isConnected(me.deviceId); i += 1) {
        await new Promise((r) => setTimeout(r, 20));
      }
      for (let i = 0; i < 100 && bridge.capabilitiesOf(me.deviceId).length === 0; i += 1) {
        await new Promise((r) => setTimeout(r, 20));
      }

      await expect(
        bridge.call(me.deviceId, { capability: 'host.ping', risk: 'READ', deadlineMs: 5_000 }),
      ).resolves.toEqual({ pong: true });

      await expect(
        bridge.call(me.deviceId, { capability: 'files.delete', risk: 'READ' }),
      ).rejects.toThrow(/did not declare/);

      ws.close();
    }, 60_000);
  });

  describe('AC-15 … AC-16: the audit trail cannot be rewritten', () => {
    it('AC-15: the hash chain verifies over everything this run produced', async () => {
      const chain = await withTenant(db, me.tenantId, (tx) => readAuditChain(tx, me.tenantId));
      expect(chain.length).toBeGreaterThan(5);
      expect(chain.map((r) => r.action)).toEqual(
        expect.arrayContaining(['session.created', 'task.created', 'artifact.created']),
      );
      expect(await verifyAuditChain(chain)).toEqual([]);
    });

    it('AC-16: the database refuses to mutate receipts and audit events', async () => {
      for (const table of ['action_receipts', 'audit_events'] as const) {
        await expect(
          withTenant(db, me.tenantId, (tx) =>
            tx.updateTable(table).set({ tenant_id: me.tenantId }).execute(),
          ),
        ).rejects.toThrow(/append-only/);
        await expect(
          withTenant(db, me.tenantId, (tx) => tx.deleteFrom(table).execute()),
        ).rejects.toThrow(/append-only/);
      }
    });
  });
});
