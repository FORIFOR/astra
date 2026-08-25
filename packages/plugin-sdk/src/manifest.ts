/**
 * Plugin manifest の読み込みと検証。実装仕様 §9.1・§9.2。
 *
 * スキーマと不変条件は `@astra/contracts` にある（逸脱 D-12）。
 * ここが引き受けるのは YAML の読み込み・正規化・署名検証・publisher 鍵の管理。
 */
import { readFile } from 'node:fs/promises';
import { parse as parseYaml } from 'yaml';
import {
  AstraError,
  PluginManifest,
  canonicalJson,
  canonicalSha256,
  type SignatureState,
} from '@astra/contracts';

export interface LoadedManifest {
  readonly manifest: PluginManifest;
  /** 署名対象の正規化 JSON。ここから 1 バイトでもずれると検証が落ちる。 */
  readonly canonical: string;
  readonly sha256: string;
}

/** 署名対象は `signature` を除いた正規化 JSON（実装仕様 §9.2）。 */
export function signingPayload(manifest: PluginManifest): string {
  const { signature: _signature, ...rest } = manifest;
  return canonicalJson(rest);
}

export function parseManifest(source: unknown, origin: string): PluginManifest {
  const parsed = PluginManifest.safeParse(source);
  if (!parsed.success) {
    throw new AstraError('plugin.manifest_invalid', `invalid manifest at ${origin}`, {
      details: parsed.error.issues.map((i) => ({
        path: i.path.join('.'),
        message: i.message,
      })),
    });
  }
  return parsed.data;
}

export async function loadManifest(source: unknown, origin: string): Promise<LoadedManifest> {
  const manifest = parseManifest(source, origin);
  const canonical = signingPayload(manifest);
  return { manifest, canonical, sha256: await canonicalSha256(JSON.parse(canonical)) };
}

export async function loadManifestFile(path: string): Promise<LoadedManifest> {
  let raw: string;
  try {
    raw = await readFile(path, 'utf8');
  } catch {
    throw new AstraError('plugin.manifest_invalid', `cannot read manifest at ${path}`);
  }

  let document: unknown;
  try {
    document = parseYaml(raw);
  } catch (error) {
    throw new AstraError('plugin.manifest_invalid', `manifest at ${path} is not valid YAML`, {
      details: { reason: error instanceof Error ? error.message : 'unknown' },
    });
  }
  return loadManifest(document, path);
}

/**
 * 署名状態を判定する。
 *
 * 同梱プラグインはアプリのバンドルごと配布されるので、その完全性は
 * アプリ本体の署名が担保する。外部プラグインは必ず署名検証を通す。
 * どちらでもないものは `UNSIGNED` で、登録側が拒否する（DB の CHECK でも弾く）。
 */
export function signatureStateFor(manifest: PluginManifest, verified: boolean): SignatureState {
  if (manifest.builtin) return 'BUILTIN_TRUSTED';
  return verified ? 'VERIFIED' : 'UNSIGNED';
}
