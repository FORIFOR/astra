/**
 * PKCE。RFC 7636。
 *
 * **plain を使わない。**`code_challenge_method=plain` は、
 * 認可コードを盗れる相手には何の防御にもならない。
 * 対応していない提供者は、対応していないと言う（黙って plain に落ちない）。
 */

const VERIFIER_BYTES = 64;

/** RFC 7636 §4.1: 43〜128 文字の unreserved。 */
export const MIN_VERIFIER_LENGTH = 43;
export const MAX_VERIFIER_LENGTH = 128;

function base64url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** 暗号品質の乱数。**Math.random を使わない。** */
export function randomToken(bytes = 32): string {
  const buffer = new Uint8Array(bytes);
  globalThis.crypto.getRandomValues(buffer);
  return base64url(buffer);
}

export interface Pkce {
  readonly verifier: string;
  readonly challenge: string;
  /** S256 のみ。plain は返さない。 */
  readonly method: 'S256';
}

export async function createPkce(verifier = randomToken(VERIFIER_BYTES)): Promise<Pkce> {
  if (verifier.length < MIN_VERIFIER_LENGTH || verifier.length > MAX_VERIFIER_LENGTH) {
    throw new Error(
      `code_verifier must be ${MIN_VERIFIER_LENGTH}..${MAX_VERIFIER_LENGTH} characters (got ${verifier.length})`,
    );
  }
  const digest = await globalThis.crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(verifier),
  );
  return { verifier, challenge: base64url(new Uint8Array(digest)), method: 'S256' };
}
