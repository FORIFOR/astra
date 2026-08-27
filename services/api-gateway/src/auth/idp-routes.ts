/**
 * 外部の身元提供者でのサインイン経路。実装仕様 §4.3。
 *
 *   GET  /v1/auth/providers      どの提供者で入れるか（設定されているものだけ true）
 *   POST /v1/auth/idp/token      提供者の ID トークン → Astra のトークン
 *   GET  /v1/auth/line/desktop   LINE の relay（ブラウザ → LINE → callback → 端末の loopback）
 *   GET  /v1/auth/line/callback
 *   GET  /v1/auth/apple/desktop  Apple の web relay（form_post を受けて loopback へ）
 *   POST /v1/auth/apple/callback
 *
 * relay がサーバに要るのは、LINE が channel secret を、Apple の web flow が
 * 公開 https の折り返し先を要求するため。**relay は ID トークンを端末へ渡すだけ**で、
 * サインインそのものは常に /v1/auth/idp/token を通る（経路を 1 本にする）。
 */
import {
  AstraError,
  AuthProvidersResponse,
  IdpSignInRequest,
  type TokenResponse,
  uuidv7,
} from '@astra/contracts';
import { withIdentity, withTenant, type DbHandle } from '@astra/db';
import { appendAuditEvent } from '@astra/telemetry';
import type { App } from '../fastify.js';
import { AUTH_RATE_LIMIT } from '../plugins/rate-limit.js';
import { issueTokens } from './routes.js';
import { createSession } from './sessions.js';
import type { JwtTokens } from './tokens.js';
import {
  APPLE_AUTHORIZE_URL,
  LINE_AUTHORIZE_URL,
  LINE_TOKEN_URL,
  type IdentityVerifier,
  type VerifiedIdentity,
} from './idp.js';

export interface IdpRouteDeps {
  readonly db: DbHandle;
  readonly tokens: JwtTokens;
  readonly verifier: IdentityVerifier;
  readonly enableDevTokens: boolean;
  readonly fetchImpl?: typeof fetch;
}

/** 端末の loopback へ戻る。ブラウザの窓は閉じてよいと伝える。 */
function loopbackPage(target: URL, ok: boolean, message: string): string {
  const title = ok ? 'サインインできました' : 'サインインできませんでした';
  const body = ok ? 'Astra に戻ります。このウィンドウは閉じて構いません。' : message;
  const href = target.toString().replace(/"/g, '&quot;');
  return `<!doctype html><html lang="ja"><head><meta charset="utf-8"><title>${title}</title>
<style>body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:#F7F8FA;color:#17191D;display:flex;align-items:center;justify-content:center;height:100vh;margin:0}
.card{background:#fff;border:1px solid #E6E8EC;border-radius:12px;padding:32px 40px;max-width:420px;text-align:center}
h1{font-size:18px;margin:0 0 8px}p{color:#667085;font-size:14px;margin:0}</style></head>
<body><div class="card"><h1>${title}</h1><p>${body}</p></div>
<script>location.replace("${href}");setTimeout(function(){window.close()},1500)</script></body></html>`;
}

function parseRelayState(raw: string | undefined): { port: number; state: string } {
  const [portText, ...rest] = (raw ?? '').split(':');
  const port = Number.parseInt(portText ?? '', 10);
  const state = rest.join(':');
  if (!Number.isInteger(port) || port < 1024 || port > 65535 || state.length === 0) {
    throw new AstraError('common.validation_failed', 'relay state is malformed');
  }
  return { port, state };
}

function loopbackTarget(port: number, params: Record<string, string>): URL {
  const url = new URL(`http://127.0.0.1:${port}/callback`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return url;
}

/**
 * 提供者の主体を Astra の user に結ぶ。
 *
 * 1. 同じ (provider, subject) が居ればその user
 * 2. 居なければ、**確認済みの**メールが一致する user に結ぶ（別の提供者で入った本人）
 * 3. それも無ければ、personal tenant と user を作る
 *
 * 未確認のメールで既存 user に結ばない。そこを緩めると、他人のメールを名乗って乗っ取れる。
 */
export async function linkIdentity(
  db: DbHandle,
  identity: VerifiedIdentity,
  device: { name: string; platform: string; appVersion: string },
): Promise<{ userId: string; tenantId: string; deviceId: string; created: boolean }> {
  return withIdentity(db, async (tx) => {
    const linked = await tx
      .selectFrom('user_identities')
      .innerJoin('users', 'users.id', 'user_identities.user_id')
      .select(['users.id as id'])
      .where('user_identities.provider', '=', identity.provider)
      .where('user_identities.subject', '=', identity.subject)
      .where('users.deleted_at', 'is', null)
      .executeTakeFirst();

    let userId = linked?.id ?? null;
    let created = false;

    if (!userId && identity.email && identity.emailVerified) {
      const byEmail = await tx
        .selectFrom('users')
        .select(['id'])
        .where('email', '=', identity.email)
        .where('deleted_at', 'is', null)
        .executeTakeFirst();
      userId = byEmail?.id ?? null;
    }

    let tenantId: string;
    if (userId) {
      const membership = await tx
        .selectFrom('memberships')
        .select(['tenant_id'])
        .where('user_id', '=', userId)
        .executeTakeFirst();
      if (!membership) throw new AstraError('common.internal', 'user without a tenant');
      tenantId = membership.tenant_id;
    } else {
      userId = uuidv7();
      tenantId = uuidv7();
      const displayName = identity.displayName ?? identity.email?.split('@')[0] ?? 'Astra User';
      // 確認済みのメールだけを users.email に使う。未確認のメールで行を作ると、
      // 本人が後で正しく入ってきたときに衝突する。取れない提供者（LINE の scope 無し等）も同じ扱い
      const email =
        identity.emailVerified && identity.email
          ? identity.email
          : `${identity.provider}-${identity.subject}@users.astra.local`;
      await tx
        .insertInto('tenants')
        .values({ id: tenantId, name: displayName, kind: 'personal' })
        .execute();
      await tx
        .insertInto('users')
        .values({ id: userId, email, display_name: displayName })
        .execute();
      await tx
        .insertInto('memberships')
        .values({ tenant_id: tenantId, user_id: userId, role: 'owner' })
        .execute();
      created = true;
    }

    if (!linked) {
      await tx
        .insertInto('user_identities')
        .values({
          provider: identity.provider,
          subject: identity.subject,
          user_id: userId,
          email: identity.emailVerified ? identity.email : null,
          last_seen_at: new Date(),
        })
        .execute();
    } else {
      await tx
        .updateTable('user_identities')
        .set({ last_seen_at: new Date() })
        .where('provider', '=', identity.provider)
        .where('subject', '=', identity.subject)
        .execute();
    }

    const deviceId = uuidv7();
    await tx
      .insertInto('devices')
      .values({
        id: deviceId,
        tenant_id: tenantId,
        user_id: userId,
        platform: device.platform,
        name: device.name,
        app_version: device.appVersion,
      })
      .execute();

    return { userId, tenantId, deviceId, created };
  });
}

export function registerIdpRoutes(app: App, deps: IdpRouteDeps): void {
  const fetchImpl = deps.fetchImpl ?? fetch;

  app.get('/v1/auth/providers', { config: { auth: false, rateLimit: AUTH_RATE_LIMIT } }, async () =>
    AuthProvidersResponse.parse({
      providers: deps.verifier.providers(),
      dev_email: deps.enableDevTokens,
    }),
  );

  app.post(
    '/v1/auth/idp/token',
    { config: { auth: false, rateLimit: AUTH_RATE_LIMIT } },
    async (request): Promise<TokenResponse> => {
      const body = IdpSignInRequest.parse(request.body ?? {});
      const identity = await deps.verifier.verify(body);
      const principal = await linkIdentity(deps.db, identity, {
        name: body.device_name,
        platform: body.platform,
        appVersion: body.app_version,
      });
      const refresh = await withTenant(deps.db, principal.tenantId, async (tx) => {
        const issued = await createSession(tx, principal);
        await appendAuditEvent(tx, principal.tenantId, {
          actorType: 'user',
          actorId: principal.userId,
          action: 'session.created',
          payload: {
            device_id: principal.deviceId,
            session_id: issued.sessionId,
            provider: identity.provider,
            first_sign_in: principal.created,
          },
        });
        return issued;
      });
      return issueTokens(deps.tokens, principal, refresh.token);
    },
  );

  // ---------------------------------------------------------------- LINE relay

  const config = deps.verifier.config;

  app.get<{ Querystring: { port?: string; state?: string } }>(
    '/v1/auth/line/desktop',
    { config: { auth: false, rateLimit: AUTH_RATE_LIMIT } },
    async (request, reply) => {
      if (!config.line || !config.publicUrl) {
        throw new AstraError('auth.provider_not_configured', 'line relay is not configured');
      }
      const { port, state } = parseRelayState(
        `${request.query.port ?? ''}:${request.query.state ?? ''}`,
      );
      const url = new URL(LINE_AUTHORIZE_URL);
      url.searchParams.set('response_type', 'code');
      url.searchParams.set('client_id', config.line.channelId);
      url.searchParams.set('redirect_uri', `${config.publicUrl}/v1/auth/line/callback`);
      url.searchParams.set('state', `${port}:${state}`);
      url.searchParams.set('scope', 'openid profile email');
      return reply.redirect(url.toString());
    },
  );

  app.get<{
    Querystring: { code?: string; state?: string; error?: string; error_description?: string };
  }>(
    '/v1/auth/line/callback',
    { config: { auth: false, rateLimit: AUTH_RATE_LIMIT } },
    async (request, reply) => {
      const { port, state } = parseRelayState(request.query.state);
      const fail = (message: string): unknown =>
        reply
          .type('text/html; charset=utf-8')
          .send(loopbackPage(loopbackTarget(port, { error: message, state }), false, message));
      if (request.query.error) {
        return fail(request.query.error_description ?? request.query.error);
      }
      if (!config.line || !config.publicUrl) return fail('LINE は設定されていません');
      if (!request.query.code) return fail('認可コードがありません');

      // code → token。channel secret はここにしか無い（端末へ渡さない）
      const response = await fetchImpl(LINE_TOKEN_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          code: request.query.code,
          redirect_uri: `${config.publicUrl}/v1/auth/line/callback`,
          client_id: config.line.channelId,
          client_secret: config.line.channelSecret,
        }).toString(),
      });
      const json = (await response.json().catch(() => ({}))) as Record<string, unknown>;
      const idToken = typeof json['id_token'] === 'string' ? json['id_token'] : null;
      if (!response.ok || !idToken) {
        request.log.warn({ status: response.status }, 'line token exchange failed');
        return fail('LINE との交換に失敗しました');
      }
      // 端末は受け取った id_token を /v1/auth/idp/token へ出す。検証はそこで（1 本の経路）
      return reply
        .type('text/html; charset=utf-8')
        .send(loopbackPage(loopbackTarget(port, { id_token: idToken, state }), true, ''));
    },
  );

  // ---------------------------------------------------------------- Apple web relay

  app.get<{ Querystring: { port?: string; state?: string } }>(
    '/v1/auth/apple/desktop',
    { config: { auth: false, rateLimit: AUTH_RATE_LIMIT } },
    async (request, reply) => {
      if (!config.apple?.serviceId || !config.publicUrl) {
        throw new AstraError('auth.provider_not_configured', 'apple relay is not configured');
      }
      const { port, state } = parseRelayState(
        `${request.query.port ?? ''}:${request.query.state ?? ''}`,
      );
      const url = new URL(APPLE_AUTHORIZE_URL);
      url.searchParams.set('response_type', 'code id_token');
      url.searchParams.set('response_mode', 'form_post');
      url.searchParams.set('client_id', config.apple.serviceId);
      url.searchParams.set('redirect_uri', `${config.publicUrl}/v1/auth/apple/callback`);
      url.searchParams.set('scope', 'name email');
      url.searchParams.set('state', `${port}:${state}`);
      return reply.redirect(url.toString());
    },
  );

  app.post<{ Body: { id_token?: string; state?: string; user?: string; error?: string } }>(
    '/v1/auth/apple/callback',
    { config: { auth: false, rateLimit: AUTH_RATE_LIMIT } },
    async (request, reply) => {
      const body = request.body ?? {};
      const { port, state } = parseRelayState(body.state);
      const fail = (message: string): unknown =>
        reply
          .type('text/html; charset=utf-8')
          .send(loopbackPage(loopbackTarget(port, { error: message, state }), false, message));
      if (body.error) return fail(body.error);
      if (!body.id_token) return fail('Apple から ID トークンが返りませんでした');
      // 名前は初回だけ `user` に JSON で来る。トークンには入らないので、ここで拾って端末へ
      let displayName = '';
      if (typeof body.user === 'string') {
        try {
          const user = JSON.parse(body.user) as {
            name?: { firstName?: string; lastName?: string };
          };
          displayName = [user.name?.lastName, user.name?.firstName].filter(Boolean).join(' ');
        } catch {
          displayName = '';
        }
      }
      return reply.type('text/html; charset=utf-8').send(
        loopbackPage(
          loopbackTarget(port, {
            id_token: body.id_token,
            state,
            ...(displayName ? { display_name: displayName } : {}),
          }),
          true,
          '',
        ),
      );
    },
  );
}
