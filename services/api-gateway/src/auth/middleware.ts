/**
 * 認証フック。実装仕様 §11.1。
 *
 * **既定は認証必須。** 公開したいルートだけが `config.auth: false` を宣言する。
 * 逆（既定で公開）にすると、ルートを足した人が宣言を忘れた瞬間に穴が開く。
 */
import { AstraError } from '@astra/contracts';
import type { App } from '../fastify.js';
import { currentRequestContext } from '../request-context.js';
import { bearerToken, type TokenVerifier } from './tokens.js';

declare module 'fastify' {
  interface FastifyContextConfig {
    /** false のときだけ未認証で通す。既定（未指定）は認証必須。 */
    auth?: boolean;
  }
}

export function registerAuth(app: App, verifier: TokenVerifier): void {
  app.addHook('preHandler', async (request) => {
    // 一致するルートが無い要求（404）はここで止めない。認証の有無で
    // 「存在しない経路」と「認証が要る経路」を混同させると、デバッグが著しく難しくなる。
    // 逸脱 D-11 は資源の存在を隠す話であって、経路名は公開仕様なので隠す対象ではない。
    if (request.routeOptions.url === undefined) return;
    if (request.routeOptions.config.auth === false) return;

    const token = bearerToken(request.headers.authorization);
    if (!token) throw new AstraError('auth.missing_token', 'authorization header required');

    const claims = await verifier.verifyAccessToken(token);

    const context = currentRequestContext();
    if (context) {
      context.userId = claims.sub;
      context.tenantId = claims.tid;
      context.deviceId = claims.did;
    }
    request.log = request.log.child({ tenant_id: claims.tid });
  });
}

/** 認証済みであることを要求してプリンシパルを取り出す。 */
export function requirePrincipal(): { userId: string; tenantId: string; deviceId: string } {
  const context = currentRequestContext();
  if (!context?.userId || !context.tenantId || !context.deviceId) {
    // 認証フックを通っていないルートでプリンシパルを読もうとしている = 配線ミス
    throw new AstraError('auth.missing_token', 'no authenticated principal in this request');
  }
  return { userId: context.userId, tenantId: context.tenantId, deviceId: context.deviceId };
}
