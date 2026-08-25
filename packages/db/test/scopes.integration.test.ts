/**
 * テナント境界の結合テスト。実装仕様 §4.4 / §5.4、チケット P0-05 の DoD。
 *
 * 実 DB が要る。次で起動する:
 *   ./infra/db/with-test-db.sh pnpm --filter @astra/db test
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { uuidv7 } from '@astra/contracts';
import { createDb, type DbHandle } from '../src/pool.js';
import type { DbConfig } from '../src/config.js';
import {
  currentScopeKind,
  currentTenantId,
  readTenantSetting,
  withIdentity,
  withSystem,
  withTenant,
} from '../src/tenant.js';

const url = process.env['TEST_DATABASE_URL'];
const identityUrl = process.env['TEST_IDENTITY_DATABASE_URL'];

const baseConfig = (overrides: Partial<DbConfig> = {}): DbConfig => ({
  url: url!,
  identityUrl,
  maxConnections: 4,
  identityMaxConnections: 2,
  idleTimeoutMillis: 5_000,
  connectionTimeoutMillis: 5_000,
  statementTimeoutMillis: 10_000,
  applicationName: 'astra-test',
  ...overrides,
});

const tenantA = uuidv7();
const tenantB = uuidv7();
const userA = uuidv7();
const userB = uuidv7();
const taskA = uuidv7();
const taskB = uuidv7();

describe.skipIf(!url)('database scopes', () => {
  let handle: DbHandle;

  beforeAll(async () => {
    handle = createDb(baseConfig());

    // サインアップ相当。テナント確定前なので identity スコープでしか書けない。
    await withIdentity(handle, async (tx) => {
      await tx
        .insertInto('tenants')
        .values([
          { id: tenantA, name: 'A', kind: 'personal' },
          { id: tenantB, name: 'B', kind: 'personal' },
        ])
        .execute();
      await tx
        .insertInto('users')
        .values([
          { id: userA, email: `a-${userA}@example.com`, display_name: 'A' },
          { id: userB, email: `b-${userB}@example.com`, display_name: 'B' },
        ])
        .execute();
      await tx
        .insertInto('memberships')
        .values([
          { tenant_id: tenantA, user_id: userA, role: 'owner' },
          { tenant_id: tenantB, user_id: userB, role: 'owner' },
        ])
        .execute();
    });

    // 業務データはテナントスコープで書く
    await withTenant(handle, tenantA, (tx) =>
      tx
        .insertInto('tasks')
        .values({
          id: taskA,
          tenant_id: tenantA,
          created_by: userA,
          kind: 'echo',
          status: 'PENDING',
          idempotency_key: 'a-1',
          workflow_id: `task/${tenantA}/${taskA}`,
        })
        .execute(),
    );
    await withTenant(handle, tenantB, (tx) =>
      tx
        .insertInto('tasks')
        .values({
          id: taskB,
          tenant_id: tenantB,
          created_by: userB,
          kind: 'echo',
          status: 'PENDING',
          idempotency_key: 'b-1',
          workflow_id: `task/${tenantB}/${taskB}`,
        })
        .execute(),
    );
  });

  afterAll(async () => {
    await handle?.close();
  });

  describe('withTenant', () => {
    it('sets the tenant GUC inside the transaction', async () => {
      const seen = await withTenant(handle, tenantA, (tx) => readTenantSetting(tx));
      expect(seen).toBe(tenantA);
    });

    it('shows a tenant only its own rows', async () => {
      const a = await withTenant(handle, tenantA, (tx) =>
        tx.selectFrom('tasks').select('id').execute(),
      );
      const b = await withTenant(handle, tenantB, (tx) =>
        tx.selectFrom('tasks').select('id').execute(),
      );
      expect(a.map((r) => r.id)).toEqual([taskA]);
      expect(b.map((r) => r.id)).toEqual([taskB]);
    });

    it('hides another tenant even when the row id is known', async () => {
      const row = await withTenant(handle, tenantA, (tx) =>
        tx.selectFrom('tasks').select('id').where('id', '=', taskB).executeTakeFirst(),
      );
      expect(row).toBeUndefined();
    });

    it('rejects a write that targets another tenant', async () => {
      await expect(
        withTenant(handle, tenantA, (tx) =>
          tx
            .insertInto('tasks')
            .values({
              id: uuidv7(),
              tenant_id: tenantB,
              created_by: userB,
              kind: 'echo',
              status: 'PENDING',
              idempotency_key: 'x-1',
              workflow_id: 'task/x/1',
            })
            .execute(),
        ),
      ).rejects.toThrow(/row-level security/i);
    });

    it('silently updates zero rows across tenants rather than erroring', async () => {
      // 「更新できた」を行数で確認しないコードはこの挙動でバグを見逃す
      const result = await withTenant(handle, tenantA, (tx) =>
        tx
          .updateTable('tasks')
          .set({ title: 'hijacked' })
          .where('id', '=', taskB)
          .executeTakeFirst(),
      );
      expect(Number(result.numUpdatedRows)).toBe(0);

      const untouched = await withTenant(handle, tenantB, (tx) =>
        tx.selectFrom('tasks').select('title').where('id', '=', taskB).executeTakeFirstOrThrow(),
      );
      expect(untouched.title).toBeNull();
    });

    it('exposes the tenant through async local storage', async () => {
      expect(currentTenantId()).toBeNull();
      const inside = await withTenant(handle, tenantA, async () => currentTenantId());
      expect(inside).toBe(tenantA);
      expect(currentTenantId()).toBeNull();
    });

    it('rejects a malformed tenant id before touching the database', async () => {
      await expect(withTenant(handle, 'not-a-uuid', async () => 1)).rejects.toThrow(
        /invalid tenant id/,
      );
    });
  });

  describe('nesting', () => {
    it('joins the outer transaction for the same tenant', async () => {
      const orphan = uuidv7();
      await expect(
        withTenant(handle, tenantA, async () => {
          await withTenant(handle, tenantA, (tx) =>
            tx
              .insertInto('tasks')
              .values({
                id: orphan,
                tenant_id: tenantA,
                created_by: userA,
                kind: 'echo',
                status: 'PENDING',
                idempotency_key: 'nested-1',
                workflow_id: `task/${tenantA}/${orphan}`,
              })
              .execute(),
          );
          throw new Error('outer failure');
        }),
      ).rejects.toThrow('outer failure');

      // 相乗りしていれば外側の rollback で内側の書き込みも消える
      const found = await withTenant(handle, tenantA, (tx) =>
        tx.selectFrom('tasks').select('id').where('id', '=', orphan).executeTakeFirst(),
      );
      expect(found).toBeUndefined();
    });

    it('refuses to nest a different tenant', async () => {
      await expect(
        withTenant(handle, tenantA, async () => withTenant(handle, tenantB, async () => 1)),
      ).rejects.toThrow(/different tenant/);
    });

    it('refuses to open a system scope inside a tenant scope', async () => {
      await expect(
        withTenant(handle, tenantA, async () => withSystem(handle, async () => 1)),
      ).rejects.toThrow(/cannot be opened inside a tenant scope/);
    });

    it('refuses to open an identity scope inside a tenant scope', async () => {
      await expect(
        withTenant(handle, tenantA, async () => withIdentity(handle, async () => 1)),
      ).rejects.toThrow(/cannot be opened inside a tenant scope/);
    });
  });

  describe('withSystem', () => {
    it('sees no tenant rows at all', async () => {
      const rows = await withSystem(handle, (tx) => tx.selectFrom('tasks').select('id').execute());
      expect(rows).toEqual([]);
      const setting = await withSystem(handle, (tx) => readTenantSetting(tx));
      expect(setting).toBeNull();
    });

    it('can reach the tenant-independent plugin catalog', async () => {
      const rows = await withSystem(handle, (tx) =>
        tx.selectFrom('plugins').select('id').execute(),
      );
      expect(Array.isArray(rows)).toBe(true);
    });

    it('reports its scope kind', async () => {
      expect(await withSystem(handle, async () => currentScopeKind())).toBe('system');
    });
  });

  describe('withIdentity', () => {
    it('can read users without a tenant (login happens before the tenant is known)', async () => {
      const found = await withIdentity(handle, (tx) =>
        tx.selectFrom('users').select(['id', 'email']).where('id', '=', userA).executeTakeFirst(),
      );
      expect(found?.id).toBe(userA);
    });

    it('cannot reach non-identity tables even though it bypasses RLS', async () => {
      // BYPASSRLS でも GRANT が無いので届かない（最小権限）
      await expect(
        withIdentity(handle, (tx) => tx.selectFrom('tasks').select('id').execute()),
      ).rejects.toThrow(/permission denied/i);
    });

    it('refuses to run when no identity connection is configured', async () => {
      const noIdentity = createDb(baseConfig({ identityUrl: undefined }));
      try {
        await expect(withIdentity(noIdentity, async () => 1)).rejects.toThrow(
          /ASTRA_DB_IDENTITY_URL/,
        );
      } finally {
        await noIdentity.close();
      }
    });
  });
});
