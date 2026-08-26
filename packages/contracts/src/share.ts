/**
 * 共有リンク。正本 §2.3、Phase 2 実装仕様 §2。
 *
 * **既定は非公開。**共有は明示的に始めるものであって、既定の状態ではない。
 */
import { z } from 'zod';
import { ArtifactId, TenantId, UserId } from './ids.js';
import { Sha256Hex, Timestamp } from './primitives.js';

export const ShareId = z.uuid().brand<'ShareId'>();
export type ShareId = z.infer<typeof ShareId>;

/** 正本 §2.3 の expiry。custom は秒数で受ける。 */
export const SHARE_EXPIRY_PRESETS = {
  '1h': 60 * 60,
  '1d': 24 * 60 * 60,
  '7d': 7 * 24 * 60 * 60,
  '30d': 30 * 24 * 60 * 60,
} as const;

export type ShareExpiryPreset = keyof typeof SHARE_EXPIRY_PRESETS;

/** 期限は必須。**無期限の共有を作らせない。** */
export const MAX_SHARE_TTL_SECONDS = 365 * 24 * 60 * 60;

export const CreateShareRequest = z
  .object({
    /** どちらか一方。両方無いと期限なしになってしまうので拒否する。 */
    expires_in: z.enum(['1h', '1d', '7d', '30d']).optional(),
    expires_in_seconds: z.number().int().positive().max(MAX_SHARE_TTL_SECONDS).optional(),
    /** 利用者が選ぶ低エントロピーの秘密。Argon2id で保存する。 */
    password: z.string().min(4).max(200).optional(),
    allow_download: z.boolean().default(false),
    /** 一度開いたら失効する。 */
    one_time: z.boolean().default(false),
    /** メールアドレスかドメイン（`@example.com`）。空なら誰でも。 */
    allowlist: z.array(z.string().min(3).max(320)).max(50).default([]),
    watermark: z.boolean().default(false),
  })
  .refine((v) => v.expires_in !== undefined || v.expires_in_seconds !== undefined, {
    message: 'an expiry is required; shares never live forever',
    path: ['expires_in'],
  });
export type CreateShareRequest = z.infer<typeof CreateShareRequest>;

export function ttlSecondsOf(request: CreateShareRequest): number {
  if (request.expires_in_seconds !== undefined) return request.expires_in_seconds;
  return SHARE_EXPIRY_PRESETS[request.expires_in!];
}

export const SharePolicy = z.object({
  allow_download: z.boolean(),
  one_time: z.boolean(),
  requires_password: z.boolean(),
  allowlist: z.array(z.string()),
  watermark: z.boolean(),
});
export type SharePolicy = z.infer<typeof SharePolicy>;

export const Share = z.object({
  id: ShareId,
  tenant_id: TenantId,
  artifact_id: ArtifactId,
  created_by: UserId,
  policy: SharePolicy,
  expires_at: Timestamp,
  revoked_at: Timestamp.nullable(),
  /** 一回限りの共有が使われた時刻。 */
  consumed_at: Timestamp.nullable(),
  access_count: z.number().int().nonnegative(),
  created_at: Timestamp,
});
export type Share = z.infer<typeof Share>;

/** 発行直後だけ返る。**平文のトークンはこの一度きり。** */
export const IssuedShare = Share.extend({
  url_token: z.string().min(1),
});
export type IssuedShare = z.infer<typeof IssuedShare>;

/**
 * 公開 viewer に返すもの。
 *
 * **テナントも所有者も出さない。**共有相手に組織の内部構造を教えない。
 */
export const SharedArtifactView = z.object({
  title: z.string(),
  mime_type: z.string(),
  size: z.number().int().nonnegative(),
  created_at: Timestamp,
  policy: SharePolicy.pick({ allow_download: true, watermark: true }),
});
export type SharedArtifactView = z.infer<typeof SharedArtifactView>;

export const UnlockShareRequest = z.object({
  password: z.string().max(200).optional(),
  /** allowlist を使う共有で、閲覧者が名乗るアドレス。 */
  email: z.email().optional(),
});
export type UnlockShareRequest = z.infer<typeof UnlockShareRequest>;

/**
 * 共有の失敗理由。
 *
 * **クライアントへはこれを返さない。**「期限切れ」と「パスワード違い」を区別して返すと、
 * 有効なトークンの存在を教えることになる（Phase 2 実装仕様 §2.3-3）。
 * 監査と診断のためだけに使う。
 */
export const ShareDenialReason = z.enum([
  'not_found',
  'revoked',
  'expired',
  'consumed',
  'password_required',
  'password_mismatch',
  'not_allowlisted',
]);
export type ShareDenialReason = z.infer<typeof ShareDenialReason>;

export const ShareAccessLog = z.object({
  share_id: ShareId,
  accessed_at: Timestamp,
  outcome: z.enum(['granted', 'denied']),
  reason: ShareDenialReason.nullable(),
  /** 監査のための粗い識別。生の IP は残さない（正本 §21）。 */
  requester_hash: Sha256Hex.nullable(),
});
export type ShareAccessLog = z.infer<typeof ShareAccessLog>;

/**
 * allowlist の判定。
 *
 * `@example.com` の形はドメイン一致、それ以外は完全一致（大文字小文字は無視）。
 * 空なら誰でも通す。
 */
export function isAllowlisted(allowlist: readonly string[], email: string | undefined): boolean {
  if (allowlist.length === 0) return true;
  if (!email) return false;
  const normalized = email.trim().toLowerCase();
  const domain = normalized.slice(normalized.indexOf('@'));
  return allowlist.some((entry) => {
    const rule = entry.trim().toLowerCase();
    return rule.startsWith('@') ? rule === domain : rule === normalized;
  });
}

/** パスワード試行のレート制限。**トークン単位**（未認証の相手に利用者は無い）。 */
export const SHARE_UNLOCK_RATE_LIMIT = { limit: 10, windowMs: 10 * 60_000 } as const;

/**
 * 共有 URL は**フラグメントに秘密を置く**。
 *
 *   https://share.example.com/s#v1.<shareId>.<secret>
 *
 * フラグメントはサーバへ送られないので、アクセスログにも Referer にも残らない。
 * パスに置くと、転送・ログ・プロキシのどこかで必ず秘密が漏れる。
 * viewer が JavaScript でフラグメントを読み、本文として POST する。
 */
export function shareLinkFor(host: string, token: string): string {
  return `${host.replace(/\/$/, '')}/s#${token}`;
}

export function tokenFromShareLink(hash: string): string | null {
  const value = hash.startsWith('#') ? hash.slice(1) : hash;
  return value.length > 0 ? value : null;
}

/**
 * unlock 後に発行する短命の閲覧トークン。
 * 以降の本文取得ではこれを使い、共有の秘密を再送させない。
 */
export const SHARE_VIEW_TOKEN_TTL_SECONDS = 5 * 60;
export const SHARE_VIEW_AUDIENCE = 'astra-share-view';

export const ShareViewClaims = z.object({
  iss: z.string(),
  aud: z.literal(SHARE_VIEW_AUDIENCE),
  /** 対象の共有。 */
  sub: ShareId,
  /** 解決済みのテナント。artifact を読むときに使う。 */
  tid: TenantId,
  art: ArtifactId,
  dl: z.boolean(),
  iat: z.number().int(),
  exp: z.number().int(),
});
export type ShareViewClaims = z.infer<typeof ShareViewClaims>;

export const UnlockShareResponse = z.object({
  view_token: z.string(),
  expires_in: z.number().int().positive(),
  artifact: SharedArtifactView,
});
export type UnlockShareResponse = z.infer<typeof UnlockShareResponse>;
