/**
 * 共有リンク。正本 §2.3、Phase 2 実装仕様 §2。
 *
 * 守ること:
 *   1. raw なストレージ URL を外部へ出さない
 *   2. 総当たりを止める（レート制限は呼び出し側の責務。ここは判定だけ）
 *   3. **失敗の理由を細かく教えない**（有効なトークンの存在を漏らさない）
 *   4. アクセスは必ず記録する
 *   5. 失効は即時
 */
import {
  AstraError,
  CreateShareRequest,
  IssuedShare,
  Share,
  isAllowlisted,
  ttlSecondsOf,
  uuidv7,
  type Artifact,
  type ShareDenialReason,
} from '@astra/contracts';
import { withShare, withTenant, type DbHandle, type ScopedDb } from '@astra/db';
import { appendAuditEvent } from '@astra/telemetry';
import type { LibraryService } from '@astra/service-library';
import {
  hashPassword,
  hashShareSecret,
  mintShareToken,
  parseShareToken,
  shareUrlFor,
  verifyPassword,
} from './tokens.js';

export interface ShareServiceDeps {
  readonly db: DbHandle;
  readonly library: LibraryService;
  /** 公開 viewer の場所。`https://share.example.com` の形。 */
  readonly shareHost: string;
  readonly now?: () => Date;
}

export type ShareResolution =
  | { readonly ok: true; readonly share: Share; readonly artifact: Artifact }
  | { readonly ok: false; readonly reason: ShareDenialReason };

export interface ResolveOptions {
  readonly password?: string | undefined;
  readonly email?: string | undefined;
  /** 監査に残す粗い識別。生の IP は渡さない。 */
  readonly requesterHash?: string | undefined;
}

export class ShareService {
  readonly #db: DbHandle;
  readonly #library: LibraryService;
  readonly #host: string;
  readonly #now: () => Date;

  constructor(deps: ShareServiceDeps) {
    this.#db = deps.db;
    this.#library = deps.library;
    this.#host = deps.shareHost;
    this.#now = deps.now ?? (() => new Date());
  }

  /**
   * 共有を作る。**平文のトークンが返るのはここだけ。**
   * 保存はハッシュなので、作り直す以外に取り戻す方法はない。
   */
  async create(
    tenantId: string,
    userId: string,
    artifactId: string,
    request: CreateShareRequest,
  ): Promise<{ share: IssuedShare; url: string }> {
    // 他テナントの artifact を共有できないこと。RLS で見えないので 404 になる。
    const artifact = await this.#library.get(tenantId, artifactId);

    const shareId = uuidv7();
    const { token, secret } = mintShareToken(shareId);
    const now = this.#now();
    const expiresAt = new Date(now.getTime() + ttlSecondsOf(request) * 1000);

    const row = await withTenant(this.#db, tenantId, async (tx) => {
      await tx
        .insertInto('shares')
        .values({
          id: shareId,
          tenant_id: tenantId,
          artifact_id: artifact.id,
          created_by: userId,
          token_hash: await hashShareSecret(shareId, secret),
          password_hash: request.password ? await hashPassword(request.password) : null,
          allow_download: request.allow_download,
          one_time: request.one_time,
          watermark: request.watermark,
          allowlist: [...request.allowlist],
          expires_at: expiresAt,
          created_at: now,
        })
        .execute();

      await appendAuditEvent(tx, tenantId, {
        actorType: 'user',
        actorId: userId,
        action: 'artifact.shared',
        externalEffect: true,
        payload: {
          share_id: shareId,
          artifact_id: artifact.id,
          expires_at: expiresAt.toISOString(),
          password_protected: Boolean(request.password),
          one_time: request.one_time,
          allowlist_size: request.allowlist.length,
        },
      });

      return this.#load(tx, shareId);
    });

    return {
      share: IssuedShare.parse({ ...row, url_token: token }),
      url: shareUrlFor(this.#host, token),
    };
  }

  async listForArtifact(tenantId: string, artifactId: string): Promise<Share[]> {
    return withTenant(this.#db, tenantId, async (tx) => {
      const rows = await tx
        .selectFrom('shares')
        .selectAll()
        .where('artifact_id', '=', artifactId)
        .orderBy('id', 'desc')
        .execute();
      return rows.map(toShare);
    });
  }

  /** 失効は即時。取り消したリンクは以後どのパスワードでも開かない。 */
  async revoke(tenantId: string, userId: string, shareId: string): Promise<void> {
    await withTenant(this.#db, tenantId, async (tx) => {
      const result = await tx
        .updateTable('shares')
        .set({ revoked_at: this.#now(), revoked_reason: 'revoked_by_user' })
        .where('id', '=', shareId)
        .where('revoked_at', 'is', null)
        .executeTakeFirst();
      if (Number(result.numUpdatedRows) === 0) {
        throw new AstraError('common.not_found', 'no active share to revoke');
      }
      await appendAuditEvent(tx, tenantId, {
        actorType: 'user',
        actorId: userId,
        action: 'artifact.share_revoked',
        payload: { share_id: shareId },
      });
    });
  }

  /**
   * 公開 viewer からの解決。**テナントが分からない状態で始まる**ので
   * `withShare`（共有テーブルにしか権限が無い BYPASSRLS ロール）を使う（逸脱 D-22）。
   *
   * 判定が終わってテナントが分かってから、artifact は `withTenant` で読む。
   */
  async resolve(token: string, options: ResolveOptions = {}): Promise<ShareResolution> {
    const parsed = parseShareToken(token);
    if (!parsed) return { ok: false, reason: 'not_found' };

    const outcome = await withShare(this.#db, async (tx) => {
      const row = await tx
        .selectFrom('shares')
        .selectAll()
        .where('id', '=', parsed.shareId)
        .executeTakeFirst();

      // 存在しない共有でも、記録する相手が無いのでログは残せない。
      if (!row) return { reason: 'not_found' as const, share: null };

      const presented = await hashShareSecret(parsed.shareId, parsed.secret);
      const reason = this.#denialFor(row, presented, options);

      await this.#log(tx, row, reason, options.requesterHash);

      if (reason) return { reason, share: null };

      // 使い切りと回数は、通した瞬間に確定させる。
      // 判定と更新を分けると、同時に開かれたときに二重に通る。
      await tx
        .updateTable('shares')
        .set({
          access_count: Number(row.access_count) + 1,
          ...(row.one_time ? { consumed_at: this.#now() } : {}),
        })
        .where('id', '=', row.id)
        .execute();

      return { reason: null, share: toShare(row) };
    });

    if (outcome.reason || !outcome.share) {
      return { ok: false, reason: outcome.reason ?? 'not_found' };
    }

    const artifact = await this.#library.get(outcome.share.tenant_id, outcome.share.artifact_id);
    return { ok: true, share: outcome.share, artifact };
  }

  /** 共有経由の本文取得。allow_download が false でも閲覧はできる（表示に要るため）。 */
  async content(share: Share): Promise<{ stream: NodeJS.ReadableStream; artifact: Artifact }> {
    return this.#library.readContent(share.tenant_id, share.artifact_id);
  }

  #denialFor(
    row: ShareRow,
    presentedHash: string,
    options: ResolveOptions,
  ): ShareDenialReason | null {
    // 秘密が合っているかを最初に見る。合っていないものに
    // 「期限切れ」などの内部状態を教えない。
    if (row.token_hash !== presentedHash) return 'not_found';
    if (row.revoked_at !== null) return 'revoked';
    if (row.consumed_at !== null) return 'consumed';
    if (row.expires_at.getTime() <= this.#now().getTime()) return 'expired';
    if (!isAllowlisted(row.allowlist, options.email)) return 'not_allowlisted';
    if (row.password_hash !== null && options.password === undefined) return 'password_required';
    return null;
  }

  async #log(
    tx: ScopedDb,
    row: ShareRow,
    reason: ShareDenialReason | null,
    requesterHash: string | undefined,
  ): Promise<void> {
    await tx
      .insertInto('share_access_logs')
      .values({
        id: uuidv7(),
        share_id: row.id,
        tenant_id: row.tenant_id,
        outcome: reason ? 'denied' : 'granted',
        reason,
        requester_hash: requesterHash ?? null,
        accessed_at: this.#now(),
      })
      .execute();
  }

  async #load(tx: ScopedDb, shareId: string): Promise<Share> {
    const row = await tx
      .selectFrom('shares')
      .selectAll()
      .where('id', '=', shareId)
      .executeTakeFirstOrThrow();
    return toShare(row);
  }

  /** パスワード照合。Argon2id は重いので、他の条件を通ったあとにだけ呼ぶ。 */
  async checkPassword(shareId: string, password: string): Promise<boolean> {
    return withShare(this.#db, async (tx) => {
      const row = await tx
        .selectFrom('shares')
        .select(['password_hash'])
        .where('id', '=', shareId)
        .executeTakeFirst();
      if (!row?.password_hash) return false;
      return verifyPassword(row.password_hash, password);
    });
  }
}

interface ShareRow {
  id: string;
  tenant_id: string;
  artifact_id: string;
  created_by: string;
  token_hash: string;
  password_hash: string | null;
  allow_download: boolean;
  one_time: boolean;
  watermark: boolean;
  allowlist: string[];
  expires_at: Date;
  revoked_at: Date | null;
  consumed_at: Date | null;
  access_count: number;
  created_at: Date;
}

function toShare(row: ShareRow): Share {
  return Share.parse({
    id: row.id,
    tenant_id: row.tenant_id,
    artifact_id: row.artifact_id,
    created_by: row.created_by,
    policy: {
      allow_download: row.allow_download,
      one_time: row.one_time,
      requires_password: row.password_hash !== null,
      allowlist: row.allowlist,
      watermark: row.watermark,
    },
    expires_at: row.expires_at.toISOString(),
    revoked_at: row.revoked_at?.toISOString() ?? null,
    consumed_at: row.consumed_at?.toISOString() ?? null,
    access_count: Number(row.access_count),
    created_at: row.created_at.toISOString(),
  });
}
