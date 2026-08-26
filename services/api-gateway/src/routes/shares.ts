/**
 * 共有リンクの HTTP 表面。正本 §2.3、Phase 2 実装仕様 §2。
 *
 * 二つの面がある:
 *   `/v1/...`      テナントの利用者が共有を作る・見る・取り消す（要認証）
 *   `/public/...`  共有を受け取った相手が開く（**未認証**）
 *
 * 公開面では**失敗の理由を区別して返さない**。「期限切れ」と「パスワード違い」を
 * 分けて返すと、有効なトークンの存在を教えることになる。
 */
import {
  AstraError,
  CreateShareRequest,
  SHARE_UNLOCK_RATE_LIMIT,
  SHARE_VIEW_TOKEN_TTL_SECONDS,
  SharedArtifactView,
  UnlockShareRequest,
} from '@astra/contracts';
import { z } from 'zod';
import type { ShareService } from '@astra/service-share';
import { parseShareToken, requesterFingerprint } from '@astra/service-share';
import { appendAuditEvent } from '@astra/telemetry';
import { withTenant, type DbHandle } from '@astra/db';
import type { App } from '../fastify.js';
import { requirePrincipal } from '../auth/middleware.js';
import type { JwtTokens } from '../auth/tokens.js';
import type { RateLimiter } from '../rate-limit/index.js';

export interface ShareRouteDeps {
  readonly shares: ShareService;
  readonly tokens: JwtTokens;
  readonly db: DbHandle;
  readonly rateLimiter: RateLimiter;
  /** requester のハッシュに混ぜる値。生の IP を残さないため（正本 §21）。 */
  readonly requesterSalt: string;
  readonly shareHost: string;
}

/** 公開面が返す唯一のエラー。理由は監査にだけ残す。 */
function opaqueDenial(): AstraError {
  return new AstraError('common.not_found', 'this link is not available');
}

export function registerShareRoutes(app: App, deps: ShareRouteDeps): void {
  // ---------------------------------------------------------------- tenant

  app.post<{ Params: { artifactId: string } }>(
    '/v1/artifacts/:artifactId/share',
    async (request, reply) => {
      const principal = requirePrincipal();
      const body = CreateShareRequest.parse(request.body ?? {});
      const created = await deps.shares.create(
        principal.tenantId,
        principal.userId,
        request.params.artifactId,
        body,
      );
      // 平文のトークンが返るのはここだけ。保存はハッシュなので取り戻せない。
      return reply.status(201).send({ share: created.share, url: created.url });
    },
  );

  app.get<{ Params: { artifactId: string } }>(
    '/v1/artifacts/:artifactId/shares',
    async (request) => {
      const principal = requirePrincipal();
      return {
        items: await deps.shares.listForArtifact(principal.tenantId, request.params.artifactId),
      };
    },
  );

  app.delete<{ Params: { shareId: string } }>('/v1/shares/:shareId', async (request, reply) => {
    const principal = requirePrincipal();
    await deps.shares.revoke(principal.tenantId, principal.userId, request.params.shareId);
    return reply.status(204).send();
  });

  // ---------------------------------------------------------------- public

  app.post(
    '/public/share/unlock',
    { config: { auth: false, rateLimit: false } },
    async (request) => {
      const body = UnlockShareRequest.extend({ token: z.string().min(1) }).parse(
        request.body ?? {},
      );

      const parsed = parseShareToken(body.token);
      // 形が違う時点で終わり。存在確認にも行かせない。
      if (!parsed) throw opaqueDenial();

      // **トークン単位**でレート制限する。未認証の相手に利用者は無い。
      const verdict = await deps.rateLimiter.consume(
        `share-unlock:${parsed.shareId}`,
        SHARE_UNLOCK_RATE_LIMIT.limit,
        SHARE_UNLOCK_RATE_LIMIT.windowMs,
      );
      if (!verdict.allowed) {
        throw new AstraError('common.rate_limited', 'too many attempts for this link');
      }

      const requesterHash = await requesterFingerprint(request.ip, deps.requesterSalt);
      const resolved = await deps.shares.resolve(body.token, {
        password: body.password,
        email: body.email,
        requesterHash,
      });
      if (!resolved.ok) throw opaqueDenial();

      // パスワードは他の条件を通ってから照合する（Argon2id は重い）
      if (resolved.share.policy.requires_password) {
        const ok =
          body.password !== undefined &&
          (await deps.shares.checkPassword(resolved.share.id, body.password));
        if (!ok) throw opaqueDenial();
      }

      await withTenant(deps.db, resolved.share.tenant_id, (tx) =>
        appendAuditEvent(tx, resolved.share.tenant_id, {
          actorType: 'system',
          action: 'artifact.share_accessed',
          externalEffect: true,
          payload: { share_id: resolved.share.id, artifact_id: resolved.artifact.id },
        }),
      );

      return {
        view_token: await deps.tokens.issueShareViewToken({
          shareId: resolved.share.id,
          tenantId: resolved.share.tenant_id,
          artifactId: resolved.artifact.id,
          allowDownload: resolved.share.policy.allow_download,
        }),
        expires_in: SHARE_VIEW_TOKEN_TTL_SECONDS,
        artifact: SharedArtifactView.parse({
          title: resolved.artifact.title,
          mime_type: resolved.artifact.mime_type,
          size: resolved.artifact.size,
          created_at: resolved.artifact.created_at,
          // §22: いつ切れるか・合言葉が要ったか・一度きりかを header で言う
          expires_at: resolved.share.expires_at,
          requires_password: resolved.share.policy.requires_password,
          one_time: resolved.share.policy.one_time,
          policy: {
            allow_download: resolved.share.policy.allow_download,
            watermark: resolved.share.policy.watermark,
          },
        }),
      };
    },
  );

  app.get(
    '/public/share/content',
    { config: { auth: false, rateLimit: false } },
    async (request, reply) => {
      const header = request.headers.authorization ?? '';
      const match = /^Share (.+)$/.exec(header);
      if (!match) throw opaqueDenial();

      let claims;
      try {
        claims = await deps.tokens.verifyShareViewToken(match[1]!);
      } catch {
        throw opaqueDenial();
      }

      const { stream, artifact } = await deps.shares.content({
        tenant_id: claims.tid,
        artifact_id: claims.art,
      } as never);

      return (
        reply
          .header('content-type', artifact.mime_type)
          .header('content-length', String(artifact.size))
          // ダウンロード不可の共有でも表示はできる。保存だけを止める。
          .header('content-disposition', claims.dl ? 'attachment' : 'inline')
          .header('x-content-type-options', 'nosniff')
          // 共有された本文が検索や参照元に漏れないようにする
          .header('referrer-policy', 'no-referrer')
          .header('x-robots-tag', 'noindex, nofollow')
          .header('cache-control', 'private, no-store')
          .send(stream)
      );
    },
  );
}
