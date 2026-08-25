/**
 * リフレッシュトークンとセッション。実装仕様 §4.2、逸脱 D-15。
 *
 * トークン形式:
 *
 *   v1.<tenantId>.<sessionId>.<secret>
 *
 * テナント ID を載せているのは、セッション行が RLS 配下にあるため。
 * これが無いとセッションを読むためにテナントが必要で、テナントを知るために
 * セッションを読む必要がある、という循環になる（`withIdentity` を使わずに済ませる）。
 * 偽のテナント ID を入れても、その テナントに当該セッションが無いので単に見つからない。
 *
 * 保存はハッシュのみ。平文の refresh token を DB に置かない（正本 §21）。
 */
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { sql } from 'kysely';
import { AstraError, REFRESH_TOKEN_TTL_SECONDS, sha256Hex, uuidv7 } from '@astra/contracts';
import { withTenant, type DbHandle, type ScopedDb } from '@astra/db';
import { appendAuditEvent } from '@astra/telemetry';

const TOKEN_VERSION = 'v1';
const SECRET_BYTES = 32;

export interface IssuedRefreshToken {
  readonly sessionId: string;
  readonly token: string;
  readonly expiresAt: Date;
}

interface ParsedRefreshToken {
  readonly tenantId: string;
  readonly sessionId: string;
  readonly secret: string;
}

function parseRefreshToken(token: string): ParsedRefreshToken {
  const parts = token.split('.');
  if (parts.length !== 4 || parts[0] !== TOKEN_VERSION) {
    throw new AstraError('auth.invalid_token', 'malformed refresh token');
  }
  return { tenantId: parts[1]!, sessionId: parts[2]!, secret: parts[3]! };
}

/**
 * 秘密値のハッシュ。
 *
 * 逸脱 D-15: パスワードではなく 256bit の乱数なので Argon2id を使わない。
 * 辞書攻撃の対象にならず、refresh のたびに数十ミリ秒を払う意味がない。
 * セッション ID を混ぜて、別セッションのハッシュを流用できないようにする。
 * Argon2id は利用者が選ぶ低エントロピーの秘密（共有リンクのパスワード）に取っておく。
 */
function hashSecret(sessionId: string, secret: string): Promise<string> {
  return sha256Hex(`astra.refresh.v1|${sessionId}|${secret}`);
}

function constantTimeEquals(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export interface CreateSessionInput {
  readonly tenantId: string;
  readonly userId: string;
  readonly deviceId: string;
  readonly rotatedFrom?: string | undefined;
}

/** セッションを作る。**呼び出し側のテナントトランザクション内で実行すること。** */
export async function createSession(
  tx: ScopedDb,
  input: CreateSessionInput,
  now: Date = new Date(),
): Promise<IssuedRefreshToken> {
  const sessionId = uuidv7();
  const secret = randomBytes(SECRET_BYTES).toString('base64url');
  const expiresAt = new Date(now.getTime() + REFRESH_TOKEN_TTL_SECONDS * 1000);

  await tx
    .insertInto('sessions')
    .values({
      id: sessionId,
      tenant_id: input.tenantId,
      user_id: input.userId,
      device_id: input.deviceId,
      refresh_token_hash: await hashSecret(sessionId, secret),
      rotated_from: input.rotatedFrom ?? null,
      expires_at: expiresAt,
      created_at: now,
    })
    .execute();

  return {
    sessionId,
    token: [TOKEN_VERSION, input.tenantId, sessionId, secret].join('.'),
    expiresAt,
  };
}

export interface RotationResult {
  readonly tenantId: string;
  readonly userId: string;
  readonly deviceId: string;
  readonly refresh: IssuedRefreshToken;
}

/**
 * リフレッシュトークンをローテーションする。
 *
 * 再利用検知: すでに失効したセッションが再提示されたら、そのトークンは漏れている。
 * 該当デバイスの**全セッションを失効させ**、監査に `session.reuse_detected` を残す
 * （実装仕様 §4.2、チケット P0-09 の DoD）。
 */
export async function rotateRefreshToken(
  handle: DbHandle,
  token: string,
  now: Date = new Date(),
): Promise<RotationResult> {
  const parsed = parseRefreshToken(token);

  // 重要: 判定の結果は**トランザクションの戻り値**にして、例外はコミット後に投げる。
  // 再利用検知の中で例外を投げると、そのトランザクションごと巻き戻り、
  // セッション失効も監査記録も取り消される（検知したのに何も起きない状態になる）。
  const outcome = await withTenant(handle, parsed.tenantId, async (tx) => {
    const session = await tx
      .selectFrom('sessions')
      .select([
        'id',
        'tenant_id',
        'user_id',
        'device_id',
        'refresh_token_hash',
        'expires_at',
        'revoked_at',
      ])
      .where('id', '=', parsed.sessionId)
      .executeTakeFirst();

    if (!session) return { kind: 'unknown' } as const;

    if (session.revoked_at !== null) {
      // 失効済みのトークンが再提示された = 漏洩。秘密値が一致するかは問わない。
      // 一致しないなら総当たりの試行であり、いずれにせよデバイスを切る。
      const revoked = await revokeDeviceSessions(
        tx,
        session.tenant_id,
        session.device_id,
        'refresh_token_reuse',
        now,
      );
      await appendAuditEvent(tx, session.tenant_id, {
        actorType: 'system',
        actorId: session.user_id,
        action: 'session.reuse_detected',
        payload: {
          session_id: session.id,
          device_id: session.device_id,
          revoked_sessions: revoked,
        },
      });
      return { kind: 'reuse' } as const;
    }

    const presentedHash = await hashSecret(parsed.sessionId, parsed.secret);
    if (!constantTimeEquals(presentedHash, session.refresh_token_hash)) {
      return { kind: 'mismatch' } as const;
    }

    if (session.expires_at.getTime() <= now.getTime()) {
      return { kind: 'expired' } as const;
    }

    const next = await createSession(
      tx,
      {
        tenantId: session.tenant_id,
        userId: session.user_id,
        deviceId: session.device_id,
        rotatedFrom: session.id,
      },
      now,
    );

    await tx
      .updateTable('sessions')
      .set({ revoked_at: now, revoked_reason: 'rotated' })
      .where('id', '=', session.id)
      .execute();

    await appendAuditEvent(tx, session.tenant_id, {
      actorType: 'user',
      actorId: session.user_id,
      action: 'session.rotated',
      payload: { from: session.id, to: next.sessionId },
    });

    return {
      kind: 'rotated',
      result: {
        tenantId: session.tenant_id,
        userId: session.user_id,
        deviceId: session.device_id,
        refresh: next,
      },
    } as const;
  });

  switch (outcome.kind) {
    case 'rotated':
      return outcome.result;
    case 'reuse':
      throw new AstraError('auth.refresh_reuse_detected', 'refresh token was already used');
    case 'expired':
      throw new AstraError('auth.expired_token', 'refresh token expired');
    case 'unknown':
    case 'mismatch':
      // 「存在しない」と「秘密値が違う」を区別して返さない（列挙の手掛かりにされる）
      throw new AstraError('auth.invalid_token', 'refresh token is not valid');
  }
}

/** デバイスの生きているセッションを全て失効させる。 */
export async function revokeDeviceSessions(
  tx: ScopedDb,
  tenantId: string,
  deviceId: string,
  reason: string,
  now: Date = new Date(),
): Promise<number> {
  const result = await tx
    .updateTable('sessions')
    .set({ revoked_at: now, revoked_reason: reason })
    .where('tenant_id', '=', tenantId)
    .where('device_id', '=', deviceId)
    .where('revoked_at', 'is', null)
    .executeTakeFirst();
  return Number(result.numUpdatedRows);
}

/** ログアウト。提示されたトークンのセッションだけを失効させる。 */
export async function revokeSession(
  handle: DbHandle,
  token: string,
  now: Date = new Date(),
): Promise<void> {
  const parsed = parseRefreshToken(token);
  await withTenant(handle, parsed.tenantId, async (tx) => {
    const session = await tx
      .selectFrom('sessions')
      .select(['id', 'tenant_id', 'user_id', 'refresh_token_hash', 'revoked_at'])
      .where('id', '=', parsed.sessionId)
      .executeTakeFirst();
    if (!session || session.revoked_at !== null) return;

    const presentedHash = await hashSecret(parsed.sessionId, parsed.secret);
    if (!constantTimeEquals(presentedHash, session.refresh_token_hash)) {
      throw new AstraError('auth.invalid_token', 'refresh token does not match');
    }

    await tx
      .updateTable('sessions')
      .set({ revoked_at: now, revoked_reason: 'logout' })
      .where('id', '=', session.id)
      .execute();

    await appendAuditEvent(tx, session.tenant_id, {
      actorType: 'user',
      actorId: session.user_id,
      action: 'session.revoked',
      payload: { session_id: session.id, reason: 'logout' },
    });
  });
}

/** 診断用。デバイスの生存セッション数。 */
export async function countActiveSessions(
  tx: ScopedDb,
  tenantId: string,
  deviceId: string,
): Promise<number> {
  const row = await sql<{ n: string }>`
    select count(*)::text as n from sessions
     where tenant_id = ${tenantId} and device_id = ${deviceId} and revoked_at is null
  `.execute(tx);
  return Number(row.rows[0]?.n ?? '0');
}
