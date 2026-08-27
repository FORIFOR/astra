/**
 * 正本 §25 の Action / Plugin 評価軸。
 *
 * ここは**通ってしまわないこと**を確かめる場所。
 * ほかの受け入れは「できること」を見ているが、
 * 安全は「できないこと」でしか確かめられない。
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Writable } from 'node:stream';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sha256Hex, uuidv7, type TokenResponse } from '@astra/contracts';
import { isApprovalUsable } from '@astra/policy';
import { createDb, withSystem, withTenant, type DbHandle } from '@astra/db';
import { createLogger } from '@astra/telemetry';
import { FsObjectStore, LibraryService } from '@astra/service-library';
import { PluginRegistryService } from '@astra/service-plugin-registry';
import {
  generatePublisherKeyPair,
  loadManifest,
  parseManifest,
  signManifest,
  type PluginAsset,
} from '@astra/plugin-sdk';
import { InMemoryTaskRuntime, TaskService } from '@astra/service-task';
import {
  MemoryRateLimiter,
  buildApp,
  JwtTokens,
  loadSigningKeys,
  type App,
} from '@astra/service-api-gateway';

const url = process.env['TEST_DATABASE_URL'];
const identityUrl = process.env['TEST_IDENTITY_DATABASE_URL'];
const repoRoot = fileURLToPath(new URL('../../..', import.meta.url));

const sink = new Writable({
  write(_c, _e, cb) {
    cb();
  },
});

describe.skipIf(!url)('what must not get through', () => {
  let db: DbHandle;
  let app: App;
  let registry: PluginRegistryService;
  let storeRoot: string;
  let auth: { authorization: string };
  let tenantId: string;
  const keys = generatePublisherKeyPair();
  const PUBLISHER = 'adversarial';

  const post = (url: string, payload: unknown, headers = auth) =>
    app.inject({ method: 'POST', url, headers, payload: payload as never });

  const signed = async (base: Record<string, unknown>) => {
    const unsigned = await loadManifest(base, 'adversarial');
    return loadManifest(
      { ...base, signature: signManifest(unsigned.canonical, keys.privateKey) },
      'adversarial',
    );
  };

  const assets = async (path: string, body: string): Promise<PluginAsset[]> => {
    const content = Buffer.from(body);
    return [{ path, kind: 'policy', content, sha256: await sha256Hex(content) }];
  };

  beforeAll(async () => {
    const dbConfig = {
      url: url!,
      identityUrl,
      maxConnections: 10,
      identityMaxConnections: 2,
      idleTimeoutMillis: 5_000,
      connectionTimeoutMillis: 5_000,
      statementTimeoutMillis: 20_000,
      applicationName: 'astra-adversarial',
    };
    db = createDb(dbConfig);
    storeRoot = await mkdtemp(path.join(tmpdir(), 'astra-adversarial-'));
    registry = new PluginRegistryService({ db, coreVersion: '0.1.0' });
    await registry.seedBuiltins(path.join(repoRoot, 'plugins/builtin'));

    await withSystem(db, (tx) =>
      tx
        .insertInto('plugin_publishers')
        .values({
          id: PUBLISHER,
          display_name: 'Adversarial',
          public_key: keys.publicKey,
          verified: false,
        })
        .onConflict((oc) => oc.column('id').doNothing())
        .execute(),
    );

    app = buildApp({
      config: {
        env: 'test',
        port: 0,
        host: '127.0.0.1',
        logLevel: 'silent',
        redisUrl: undefined,
        version: '0.1.0',
        db: dbConfig,
        builtinPluginsDir: path.join(repoRoot, 'plugins/builtin'),
        objectStoreRoot: storeRoot,
        recordingRoot: storeRoot,
        allowedOrigins: [],
        shareHost: 'http://localhost:1430',
        requesterSalt: 'adversarial-salt',
        idp: { google: null, apple: null, line: null, publicUrl: null },
      },
      db,
      redis: null,
      rateLimiter: new MemoryRateLimiter(),
      logger: createLogger({ service: 'adversarial', level: 'silent' }, sink),
      tokens: new JwtTokens({
        issuer: 'https://auth.astra.test',
        keys: await loadSigningKeys({ keyId: 'adversarial' }),
      }),
      tasks: new TaskService(db, new InMemoryTaskRuntime()),
      library: new LibraryService(db, new FsObjectStore(storeRoot)),
      registry,
      ssePollIntervalMs: 20,
    });
    await app.ready();

    const issued = await post(
      '/v1/auth/dev/token',
      { email: `adv-${uuidv7()}@example.com`, display_name: 'Adversarial' },
      {} as never,
    );
    auth = { authorization: `Bearer ${issued.json<TokenResponse>().access_token}` };
    tenantId = (await app.inject({ method: 'GET', url: '/v1/me', headers: auth })).json<{
      tenant: { id: string };
    }>().tenant.id;
  }, 180_000);

  afterAll(async () => {
    await app?.close();
    await db?.close();
    if (storeRoot) await rm(storeRoot, { recursive: true, force: true });
  });

  describe('a malicious manifest', () => {
    const base = {
      id: 'com.adversarial.evil',
      name: 'Evil',
      version: '1.0.0',
      publisher: PUBLISHER,
      verified: false,
      min_core_version: '0.1.0',
      category: 'connector',
      compliance_profile: 'GENERAL',
      execution_surfaces: ['cloud'],
      permissions: [],
      data_accessed: ['nothing, honestly'],
    };

    it('cannot ship a destructive tool without asking first', () => {
      // 高リスクなのに確認を求めない tool は、そもそも成立しない
      expect(() =>
        parseManifest(
          {
            ...base,
            tools: [{ id: 'evil.delete', risk: 'DESTRUCTIVE', requires_confirmation: false }],
          },
          'test',
        ),
      ).toThrow();
    });

    it('cannot claim to be built in without being verified', () => {
      expect(() => parseManifest({ ...base, builtin: true, verified: false }, 'test')).toThrow();
    });

    it('cannot run somewhere it did not declare', () => {
      expect(() =>
        parseManifest(
          {
            ...base,
            execution_surfaces: ['cloud'],
            tools: [{ id: 'evil.read', risk: 'READ', surface: 'local' }],
          },
          'test',
        ),
      ).toThrow();
    });

    it('cannot give its agent a tool it never declared', () => {
      expect(() =>
        parseManifest(
          {
            ...base,
            tools: [{ id: 'evil.read', risk: 'READ' }],
            agents: [{ id: 'a', skill: 's.md', tools: ['mail.send'] }],
          },
          'test',
        ),
      ).toThrow();
    });

    it('cannot escape its own directory through an asset path', async () => {
      const manifest = await signed({
        ...base,
        version: '1.1.0',
        policies: ['../../../etc/passwd'],
      });
      // 実体は渡さない。宣言だけで publish が通ってはいけない。
      await expect(registry.publish(manifest, [])).rejects.toThrow();
    });

    it('cannot ship a policy that only claims to be safe', async () => {
      // 散文は検査できない。語彙で書けていない policy は通さない。
      const manifest = await signed({
        ...base,
        version: '1.2.0',
        policies: ['policies/prose.yaml'],
      });
      await expect(
        registry.publish(
          manifest,
          await assets('policies/prose.yaml', 'id: prose\nrules:\n  - とても安全です\n'),
        ),
      ).rejects.toThrow(/vocabulary/);
    });

    it('cannot be published under a publisher it does not own', async () => {
      const other = generatePublisherKeyPair();
      const unsigned = await loadManifest({ ...base, version: '1.3.0' }, 'test');
      const forged = await loadManifest(
        {
          ...base,
          version: '1.3.0',
          signature: signManifest(unsigned.canonical, other.privateKey),
        },
        'test',
      );
      await expect(registry.publish(forged, [])).rejects.toThrow();
    });
  });

  describe('permission escalation', () => {
    it('cannot grant itself a scope it never declared', async () => {
      const install = await post('/v1/plugins/com.astra.gmail/install', {
        version: '0.1.0',
        // 宣言されていないが、契約上は正しい scope を混ぜる
        granted_scopes: ['email.read', 'files.read', 'calendar.write'],
      });
      expect(install.statusCode).toBe(201);

      // 宣言していない scope は付かない
      expect(await registry.isPermitted(tenantId, 'com.astra.gmail', 'files.read')).toBe(false);
      expect(await registry.isPermitted(tenantId, 'com.astra.gmail', 'calendar.write')).toBe(false);
      expect(await registry.isPermitted(tenantId, 'com.astra.gmail', 'email.read')).toBe(true);
    });

    it('cannot keep a scope across a reinstall that dropped it', async () => {
      await post('/v1/plugins/com.astra.gmail/install', {
        version: '0.1.0',
        granted_scopes: [],
      });
      expect(await registry.isPermitted(tenantId, 'com.astra.gmail', 'email.read')).toBe(false);
    });

    it('cannot remove a core capability', async () => {
      const removed = await app.inject({
        method: 'DELETE',
        url: '/v1/plugins/com.astra.research',
        headers: auth,
      });
      expect(removed.statusCode).toBe(403);
    });
  });

  describe('a stale approval', () => {
    it('is not usable once its window has passed', () => {
      // FINANCIAL の 5 分は、価格が動くから（正本 §22）
      const past = new Date(Date.now() - 1_000).toISOString();
      expect(isApprovalUsable({ status: 'APPROVED', expiresAt: past })).toBe(false);

      const future = new Date(Date.now() + 60_000).toISOString();
      expect(isApprovalUsable({ status: 'APPROVED', expiresAt: future })).toBe(true);
    });

    it('is not usable just because somebody once said yes', () => {
      const future = new Date(Date.now() + 60_000).toISOString();
      for (const status of ['PENDING', 'REJECTED', 'EXPIRED'] as const) {
        expect(isApprovalUsable({ status, expiresAt: future }), status).toBe(false);
      }
    });

    it('cannot be decided after it has expired', async () => {
      const taskId = uuidv7();
      const approvalId = uuidv7();
      await withTenant(db, tenantId, async (tx) => {
        await tx
          .insertInto('tasks')
          .values({
            id: taskId,
            tenant_id: tenantId,
            created_by: (
              await tx
                .selectFrom('plugin_installs')
                .select(['installed_by'])
                .executeTakeFirstOrThrow()
            ).installed_by,
            kind: 'echo',
            status: 'WAITING_APPROVAL',
            input: JSON.stringify({}),
            idempotency_key: `adv-${uuidv7()}`,
            workflow_id: `task/${tenantId}/${taskId}`,
          })
          .execute();
        await tx
          .insertInto('approvals')
          .values({
            id: approvalId,
            tenant_id: tenantId,
            task_id: taskId,
            step_index: 0,
            risk: 'EXTERNAL_COMMIT',
            summary: '古い承認',
            details: JSON.stringify({}),
            status: 'PENDING',
            expires_at: new Date(Date.now() - 1_000),
          })
          .execute();
      });

      const decided = await post(`/v1/tasks/${taskId}/approve`, {
        approval_id: approvalId,
        decision: 'APPROVED',
      });
      expect(decided.statusCode).toBe(409);
    });
  });

  describe('duplicate execution', () => {
    it('does not run twice for the same idempotency key', async () => {
      const key = `dup-${uuidv7()}`;
      const first = await app.inject({
        method: 'POST',
        url: '/v1/tasks',
        headers: { ...auth, 'idempotency-key': key },
        payload: { kind: 'echo', input: { message: 'once' } },
      });
      const second = await app.inject({
        method: 'POST',
        url: '/v1/tasks',
        headers: { ...auth, 'idempotency-key': key },
        payload: { kind: 'echo', input: { message: 'twice' } },
      });
      expect(second.json<{ id: string }>().id).toBe(first.json<{ id: string }>().id);
    });

    it('refuses a task with no idempotency key at all', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/tasks',
        headers: auth,
        payload: { kind: 'echo', input: {} },
      });
      // 鍵が無いと、再送で二重実行になる
      expect(res.statusCode).toBe(400);
    });
  });

  describe('another tenant', () => {
    it('is told things do not exist, never that they are forbidden', async () => {
      const outsider = await post(
        '/v1/auth/dev/token',
        { email: `out-${uuidv7()}@example.com`, display_name: 'Out' },
        {} as never,
      );
      const headers = {
        authorization: `Bearer ${outsider.json<TokenResponse>().access_token}`,
      };
      const someTask = uuidv7();
      // 403 だと「それはある」と教えることになる
      expect(
        (await app.inject({ method: 'GET', url: `/v1/tasks/${someTask}`, headers })).statusCode,
      ).toBe(404);
    });
  });
});
