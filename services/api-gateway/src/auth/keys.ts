/**
 * 署名鍵。実装仕様 §4.2。
 *
 * アクセストークンは EdDSA (Ed25519)。RSA より短く、検証が速い。
 * 本番の鍵は Secret Manager / KMS から環境変数経由で渡す（正本 §21）。
 */
import { importPKCS8, importSPKI, generateKeyPair, type CryptoKey } from 'jose';
import type { Logger } from '@astra/telemetry';

export interface SigningKeys {
  readonly privateKey: CryptoKey;
  readonly publicKey: CryptoKey;
  readonly keyId: string;
  /** プロセス起動時に生成した使い捨て鍵か。本番では必ず false。 */
  readonly ephemeral: boolean;
}

export interface KeyConfig {
  readonly privateKeyPem?: string | undefined;
  readonly publicKeyPem?: string | undefined;
  readonly keyId: string;
}

export function keyConfigFromEnv(env: NodeJS.ProcessEnv = process.env): KeyConfig {
  return {
    privateKeyPem: env['ASTRA_JWT_PRIVATE_KEY'],
    publicKeyPem: env['ASTRA_JWT_PUBLIC_KEY'],
    keyId: env['ASTRA_JWT_SIGNING_KEY_ID'] ?? 'dev-1',
  };
}

/**
 * 鍵を読み込む。PEM が無ければ使い捨ての鍵を生成する。
 *
 * 生成に倒すのは開発の起動を止めないため。ただし本番で使い捨て鍵を掴むと
 * 再起動のたびに全トークンが無効になるので、呼び出し側が `ephemeral` を見て拒否する。
 */
export async function loadSigningKeys(config: KeyConfig, logger?: Logger): Promise<SigningKeys> {
  if (config.privateKeyPem && config.publicKeyPem) {
    return {
      privateKey: await importPKCS8(config.privateKeyPem, 'EdDSA'),
      publicKey: await importSPKI(config.publicKeyPem, 'EdDSA'),
      keyId: config.keyId,
      ephemeral: false,
    };
  }

  logger?.warn(
    'no ASTRA_JWT_PRIVATE_KEY/ASTRA_JWT_PUBLIC_KEY provided; generating an ephemeral signing key',
  );
  const { privateKey, publicKey } = await generateKeyPair('EdDSA', { extractable: false });
  return { privateKey, publicKey, keyId: config.keyId, ephemeral: true };
}
