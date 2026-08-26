/**
 * 共有トークンとパスワード。Phase 2 実装仕様 §2.1。
 *
 * 二種類の秘密があり、扱いが違う:
 *   share token … 256bit の乱数。辞書攻撃が成立しないので sha256（Phase 0 逸脱 D-15）
 *   password    … 利用者が選ぶ低エントロピーの秘密。**Argon2id**。ここが本来の置き場所
 */
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { hash as argonHash, verify as argonVerify } from '@node-rs/argon2';
import { AstraError, sha256Hex, shareLinkFor } from '@astra/contracts';

const TOKEN_VERSION = 'v1';
const SECRET_BYTES = 32;

export interface ParsedShareToken {
  readonly shareId: string;
  readonly secret: string;
}

/**
 * `v1.<shareId>.<secret>`。
 *
 * shareId を含めるのは、**検証前**にレート制限と監査の対象を決めるため。
 * 秘密が合っているかに関わらず「どのリンクが狙われたか」を残せる。
 */
export function mintShareToken(shareId: string): { token: string; secret: string } {
  const secret = randomBytes(SECRET_BYTES).toString('base64url');
  return { token: [TOKEN_VERSION, shareId, secret].join('.'), secret };
}

export function parseShareToken(token: string): ParsedShareToken | null {
  const parts = token.split('.');
  if (parts.length !== 3 || parts[0] !== TOKEN_VERSION) return null;
  const [, shareId, secret] = parts;
  if (!shareId || !secret) return null;
  return { shareId, secret };
}

export function hashShareSecret(shareId: string, secret: string): Promise<string> {
  return sha256Hex(`astra.share.v1|${shareId}|${secret}`);
}

export function constantTimeEquals(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

/**
 * OWASP の推奨値（Argon2id, m=19MiB, t=2, p=1）。@node-rs/argon2 の既定がこれ。
 * `Algorithm` は ambient const enum で `verbatimModuleSyntax` から参照できないため、
 * 既定に任せたうえで、ハッシュが argon2id であることをテストで固定する。
 */
export function hashPassword(password: string): Promise<string> {
  return argonHash(password);
}

/**
 * パスワードを照合する。壊れたハッシュでも**例外を投げずに false**。
 * 区別できると「形式エラーだから通す」分岐が生まれる（plugin の署名検証と同じ判断）。
 */
export async function verifyPassword(stored: string, candidate: string): Promise<boolean> {
  try {
    return await argonVerify(stored, candidate);
  } catch {
    return false;
  }
}

/** 監査に残す requester の粗い識別。**生の IP を残さない**（正本 §21）。 */
export function requesterFingerprint(ip: string | undefined, salt: string): Promise<string> {
  return sha256Hex(`astra.share.requester|${salt}|${ip ?? 'unknown'}`);
}

export function assertShareHost(url: string): string {
  if (!/^https?:\/\//.test(url)) {
    throw new AstraError('common.internal', `share host must be an absolute URL: ${url}`);
  }
  return url.replace(/\/$/, '');
}

/**
 * 共有リンク。**秘密はフラグメントに置く**（contracts の `shareLinkFor`）。
 * パスに置くと、アクセスログ・Referer・プロキシのどこかで必ず漏れる。
 */
export function shareUrlFor(host: string, token: string): string {
  return shareLinkFor(assertShareHost(host), token);
}
