/**
 * 初期セットアップの HTTP 表面。正本 §3。
 *
 * ここが守るのは 3 つ:
 *   - **選んでも機能制限はしない**（Step 2）
 *   - **一度に全 permission を要求しない**（Step 5）
 *   - **終わったと言うには、実際に 1 つ終わらせている**（Step 7）
 */
import {
  AstraError,
  UpdateOnboardingRequest,
  permissionsFor,
  recommendationsFor,
  type InterestArea,
  type OnboardingState,
} from '@astra/contracts';
import { withTenant } from '@astra/db';
import type { DbHandle } from '@astra/db';
import type { PluginRegistryService } from '@astra/service-plugin-registry';
import type { TaskService } from '@astra/service-task';
import type { App } from '../fastify.js';
import { requirePrincipal } from '../auth/middleware.js';

export interface OnboardingRouteDeps {
  readonly db: DbHandle;
  readonly registry: PluginRegistryService;
  readonly tasks: TaskService;
}

export function registerOnboardingRoutes(app: App, deps: OnboardingRouteDeps): void {
  const load = async (tenantId: string, userId: string): Promise<OnboardingState> => {
    const row = await withTenant(deps.db, tenantId, async (tx) => {
      const existing = await tx
        .selectFrom('onboarding_states')
        .selectAll()
        .where('user_id', '=', userId)
        .executeTakeFirst();
      if (existing) return existing;

      return tx
        .insertInto('onboarding_states')
        .values({ tenant_id: tenantId, user_id: userId })
        .returningAll()
        .executeTakeFirstOrThrow();
    });
    return toState(row);
  };

  app.get('/v1/onboarding', async () => {
    const principal = requirePrincipal();
    return load(principal.tenantId, principal.userId);
  });

  app.patch('/v1/onboarding', async (request) => {
    const principal = requirePrincipal();
    const body = UpdateOnboardingRequest.parse(request.body ?? {});
    const current = await load(principal.tenantId, principal.userId);

    /*
     * 「終わった」と言うには、実際に 1 つ終わらせている必要がある（§3 Step 7）。
     * チュートリアルを最後まで送っただけで完了にすると、
     * **成功体験のないまま製品が始まる。**
     */
    const nextTaskId = body.first_task_id ?? current.first_task_id;
    if (body.step === 'done' && !nextTaskId) {
      throw new AstraError(
        'common.validation_failed',
        'onboarding is not done until one real task has finished',
      );
    }

    const row = await withTenant(deps.db, principal.tenantId, (tx) =>
      tx
        .updateTable('onboarding_states')
        .set({
          ...(body.step === undefined ? {} : { step: body.step }),
          ...(body.input_preference === undefined
            ? {}
            : { input_preference: body.input_preference }),
          ...(body.interests === undefined ? {} : { interests: [...body.interests] }),
          ...(body.installed_plugins === undefined
            ? {}
            : { installed_plugins: [...body.installed_plugins] }),
          ...(body.granted_permissions === undefined
            ? {}
            : { granted_permissions: [...body.granted_permissions] }),
          ...(body.first_task_id === undefined ? {} : { first_task_id: body.first_task_id }),
          ...(body.step === 'done' ? { completed_at: new Date() } : {}),
          updated_at: new Date(),
        })
        .where('user_id', '=', principal.userId)
        .returningAll()
        .executeTakeFirstOrThrow(),
    );
    return toState(row);
  });

  /**
   * 選んだものに応じた推薦。正本 §3 Step 4。
   *
   * **入れる前に権限を見せる。**一括で入れられるが、
   * 何が要求されるかは各件ごとに出す。
   */
  app.get<{ Querystring: { interests?: string } }>(
    '/v1/onboarding/recommendations',
    async (request) => {
      const principal = requirePrincipal();
      const state = await load(principal.tenantId, principal.userId);
      const interests = (
        request.query.interests
          ? request.query.interests.split(',').filter(Boolean)
          : state.interests
      ) as InterestArea[];

      const catalog = await deps.registry.catalog(principal.tenantId);
      return {
        items: recommendationsFor(
          interests,
          catalog.map((c) => ({ id: c.id, name: c.name, permissions: c.permissions })),
        ),
        // 使う直前に求めるための一覧。**ここでまとめて要求はしない。**
        permissions: permissionsFor(interests),
      };
    },
  );
}

function toState(row: Record<string, unknown>): OnboardingState {
  const iso = (v: unknown): string | null => (v instanceof Date ? v.toISOString() : null);
  return {
    tenant_id: row['tenant_id'],
    user_id: row['user_id'],
    step: row['step'],
    input_preference: row['input_preference'] ?? null,
    interests: row['interests'] ?? [],
    installed_plugins: row['installed_plugins'] ?? [],
    granted_permissions: row['granted_permissions'] ?? [],
    first_task_id: row['first_task_id'] ?? null,
    completed_at: iso(row['completed_at']),
    updated_at: iso(row['updated_at']),
  } as OnboardingState;
}
