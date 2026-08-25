/**
 * Ed25519 による manifest 署名。実装仕様 §9.2。
 *
 * 鍵の保管は運用側（Secret Manager / KMS）。ここは検証と、
 * 開発・テストのための署名生成だけを持つ。
 */
import { createPrivateKey, createPublicKey, generateKeyPairSync, sign, verify } from 'node:crypto';

export interface PublisherKey {
  readonly publisherId: string;
  /** base64 (SPKI DER)。`plugin_publishers.public_key` に入る形。 */
  readonly publicKey: string;
}

export function generatePublisherKeyPair(): { publicKey: string; privateKey: string } {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  return {
    publicKey: publicKey.export({ type: 'spki', format: 'der' }).toString('base64'),
    privateKey: privateKey.export({ type: 'pkcs8', format: 'der' }).toString('base64'),
  };
}

export function signManifest(canonical: string, privateKeyBase64: string): string {
  const key = createPrivateKey({
    key: Buffer.from(privateKeyBase64, 'base64'),
    format: 'der',
    type: 'pkcs8',
  });
  return sign(null, Buffer.from(canonical, 'utf8'), key).toString('base64');
}

/**
 * 署名を検証する。鍵や署名の形式が壊れていても **例外を投げずに false** を返す。
 * 検証失敗と入力不正を呼び出し側で区別する必要が無く、区別すると
 * 「形式エラーだから通す」ような分岐が生まれるため。
 */
export function verifyManifestSignature(
  canonical: string,
  signatureBase64: string | undefined,
  publicKeyBase64: string,
): boolean {
  if (!signatureBase64) return false;
  try {
    const key = createPublicKey({
      key: Buffer.from(publicKeyBase64, 'base64'),
      format: 'der',
      type: 'spki',
    });
    return verify(
      null,
      Buffer.from(canonical, 'utf8'),
      key,
      Buffer.from(signatureBase64, 'base64'),
    );
  } catch {
    return false;
  }
}
