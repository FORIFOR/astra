/**
 * install した plugin の agent を、実行できる形にして返す。
 * Phase 5 実装仕様 §2（AC5-1 / AC5-2 / AC5-5 / AC5-6）。
 *
 * task 側は `AgentResolver` という口だけを知っていて、registry を持たない。
 * 組み立てるのは gateway / worker の役目（ADR 0001）。
 */
import { parseAgentKind, type InstalledAgent } from '@astra/service-task';
import type { PluginRegistryService } from './service.js';

export function agentResolver(registry: PluginRegistryService): {
  resolve(tenantId: string, kind: string): Promise<InstalledAgent | null>;
} {
  return {
    async resolve(tenantId, kind) {
      const parsed = parseAgentKind(kind);
      if (!parsed) return null;

      const found = await registry.installedAgent(tenantId, parsed.pluginId, parsed.agentId);
      return found;
    },
  };
}

/** entity 定義を引くための asset 読み口（Phase 5 §5）。 */
export function assetReader(registry: PluginRegistryService): {
  read(tenantId: string, pluginId: string, path: string): Promise<Buffer | null>;
  extensions(tenantId: string, pluginId: string): Promise<string[]>;
} {
  return {
    read: (tenantId, pluginId, path) => registry.installedAsset(tenantId, pluginId, path),
    extensions: (tenantId, pluginId) => registry.dataExtensions(tenantId, pluginId),
  };
}
