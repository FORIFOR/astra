/**
 * 認証の経路。実装仕様 §4.3・§11。
 *
 * `/v1/auth/dev/token` は開発専用。フラグで分岐するのではなく、
 * 本番ビルドでは**ルート自体を登録しない**（§4.3）。
 */
import {
  ACCESS_TOKEN_TTL_SECONDS,
  AstraError,
  DevTokenRequest,
  MeResponse,
  RefreshRequest,
  TokenResponse,
  uuidv7,
} from '@astra/contracts';
import { withIdentity, withTenant, type DbHandle } from '@astra/db';
import { appendAuditEvent } from '@astra/telemetry';
import type { App } from '../fastify.js';
import { AUTH_RATE_LIMIT } from '../plugins/rate-limit.js';
import { requirePrincipal } from './middleware.js';
import { createSession, revokeSession, rotateRefreshToken } from './sessions.js';
import type { JwtTokens } from './tokens.js';

export interface AuthRouteDeps {
  readonly db: DbHandle;
  readonly tokens: JwtTokens;
  /** 開発用トークン発行を登録するか。実装仕様 §4.3。 */
  readonly enableDevTokens: boolean;
}

const DEFAULT_SCOPES = ['tasks:write', 'tasks:read', 'artifacts:read', 'artifacts:write'];

async function issueTokens(
  tokens: JwtTokens,
  principal: { userId: string; tenantId: string; deviceId: string },
  refreshToken: string,
): Promise<TokenResponse> {
  const p = { ...principal, scopes: DEFAULT_SCOPES };
  return {
    access_token: await tokens.issueAccessToken(p),
    refresh_token: refreshToken,
    device_token: await tokens.issueDeviceToken(p),
    expires_in: ACCESS_TOKEN_TTL_SECONDS,
    token_type: 'Bearer',
  };
}

export function registerAuthRoutes(app: App, deps: AuthRouteDeps): void {
  if (deps.enableDevTokens) {
    app.post(
      '/v1/auth/dev/token',
      { config: { auth: false, rateLimit: AUTH_RATE_LIMIT } },
      async (request) => {
        const body = DevTokenRequest.parse(request.body ?? {});

        // サインアップはテナント確定前なので identity スコープ（逸脱 D-14）
        const identity = await withIdentity(deps.db, async (tx) => {
          const existing = await tx
            .selectFrom('users')
            .select(['id'])
            .where('email', '=', body.email)
            .where('deleted_at', 'is', null)
            .executeTakeFirst();

          const userId = existing?.id ?? uuidv7();
          let tenantId: string;

          if (existing) {
            const membership = await tx
              .selectFrom('memberships')
              .select(['tenant_id'])
              .where('user_id', '=', userId)
              .executeTakeFirst();
            if (!membership) throw new AstraError('common.internal', 'user without a tenant');
            tenantId = membership.tenant_id;
          } else {
            tenantId = uuidv7();
            await tx
              .insertInto('tenants')
              .values({ id: tenantId, name: body.display_name, kind: 'personal' })
              .execute();
            await tx
              .insertInto('users')
              .values({ id: userId, email: body.email, display_name: body.display_name })
              .execute();
            await tx
              .insertInto('memberships')
              .values({ tenant_id: tenantId, user_id: userId, role: 'owner' })
              .execute();
          }

          const deviceId = uuidv7();
          await tx
            .insertInto('devices')
            .values({
              id: deviceId,
              tenant_id: tenantId,
              user_id: userId,
              platform: body.platform,
              name: body.device_name,
              app_version: body.app_version,
            })
            .execute();

          return { userId, tenantId, deviceId };
        });

        // セッション作成と監査は同じテナントトランザクションで済ませる
        const refresh = await withTenant(deps.db, identity.tenantId, async (tx) => {
          const issued = await createSession(tx, identity);
          await appendAuditEvent(tx, identity.tenantId, {
            actorType: 'user',
            actorId: identity.userId,
            action: 'session.created',
            payload: { device_id: identity.deviceId, session_id: issued.sessionId },
          });
          return issued;
        });

        return issueTokens(deps.tokens, identity, refresh.token);
      },
    );
  }

  app.post(
    '/v1/auth/refresh',
    { config: { auth: false, rateLimit: AUTH_RATE_LIMIT } },
    async (request) => {
      const body = RefreshRequest.parse(request.body ?? {});
      const rotated = await rotateRefreshToken(deps.db, body.refresh_token);
      return issueTokens(
        deps.tokens,
        { userId: rotated.userId, tenantId: rotated.tenantId, deviceId: rotated.deviceId },
        rotated.refresh.token,
      );
    },
  );

  app.post(
    '/v1/auth/logout',
    { config: { auth: false, rateLimit: AUTH_RATE_LIMIT } },
    async (request, reply) => {
      const body = RefreshRequest.parse(request.body ?? {});
      await revokeSession(deps.db, body.refresh_token);
      return reply.status(204).send();
    },
  );

  app.get('/v1/me', async () => {
    const principal = requirePrincipal();
    return withTenant(deps.db, principal.tenantId, async (tx) => {
      // user + tenant + role と device を分けて引く。1 本の join にまとめても
      // 行が増えるだけで、device は主キー 1 件の取得でしかない。
      const account = await tx
        .selectFrom('users')
        .innerJoin('memberships', 'memberships.user_id', 'users.id')
        .innerJoin('tenants', 'tenants.id', 'memberships.tenant_id')
        .select([
          'users.id as user_id',
          'users.email as email',
          'users.display_name as display_name',
          'users.created_at as user_created_at',
          'tenants.id as tenant_id',
          'tenants.name as tenant_name',
          'tenants.kind as tenant_kind',
          'tenants.compliance_profile as compliance_profile',
          'tenants.created_at as tenant_created_at',
          'memberships.role as role',
        ])
        .where('users.id', '=', principal.userId)
        .where('memberships.tenant_id', '=', principal.tenantId)
        .where('users.deleted_at', 'is', null)
        .executeTakeFirst();

      const device = await tx
        .selectFrom('devices')
        .select(['id', 'platform', 'name', 'app_version', 'last_seen_at', 'created_at'])
        .where('id', '=', principal.deviceId)
        .where('revoked_at', 'is', null)
        .executeTakeFirst();

      // どちらが欠けていても、トークンが指す主体はもう存在しない
      if (!account || !device) {
        throw new AstraError('auth.invalid_token', 'principal no longer exists');
      }

      return MeResponse.parse({
        user: {
          id: account.user_id,
          email: account.email,
          display_name: account.display_name,
          created_at: account.user_created_at.toISOString(),
        },
        tenant: {
          id: account.tenant_id,
          name: account.tenant_name,
          kind: account.tenant_kind,
          compliance_profile: account.compliance_profile,
          created_at: account.tenant_created_at.toISOString(),
        },
        device: {
          id: device.id,
          tenant_id: account.tenant_id,
          user_id: account.user_id,
          platform: device.platform,
          name: device.name,
          app_version: device.app_version,
          last_seen_at: device.last_seen_at?.toISOString() ?? null,
          created_at: device.created_at.toISOString(),
        },
        role: account.role,
      });
    });
  });
}
