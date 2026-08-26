/**
 * @astra/service-plugin-registry
 *
 * カタログ、署名、バージョン、互換性、install 状態。実装仕様 §9。
 */
export { PluginRegistryService, type RegistryDeps } from './service.js';
export {
  NO_DATA_SOURCES,
  composeDataSources,
  type DataSourceHandler,
  type DataSourceMap,
  type DataSourceResolver,
} from './data-sources.js';
export { agentResolver, assetReader } from './agent-resolver.js';
export { assertRegulatedPluginHasRules, isStrictProfile } from './compliance.js';
export {
  ConnectionService,
  type Connection,
  type ConnectInput,
  type ConnectionState,
} from './connections.js';
// 資格情報の形の規則は contracts が正。両側が別の規則を持つと、片方だけ緩む。
export { looksLikeCredential } from '@astra/contracts';
