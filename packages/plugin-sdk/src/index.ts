/**
 * @astra/plugin-sdk
 *
 * Plugin manifest の読み込み・正規化・署名検証・permission スコープの補助。
 * スキーマと不変条件は `@astra/contracts` 側（実装仕様 §3.6・§9）。
 */
export {
  loadManifest,
  loadManifestFile,
  parseManifest,
  signingPayload,
  signatureStateFor,
  type LoadedManifest,
} from './manifest.js';
export {
  declaredAssets,
  loadAssets,
  validateDashboards,
  validatePolicies,
  validateWorkflows,
  MAX_ASSET_BYTES,
  type AssetKind,
  type PluginAsset,
} from './assets.js';
export {
  generatePublisherKeyPair,
  signManifest,
  verifyManifestSignature,
  type PublisherKey,
} from './signature.js';
