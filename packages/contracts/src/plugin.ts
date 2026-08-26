/**
 * Plugin manifest。正本 §2.4 / §14 / §22、実装仕様 §3.6 / §9。
 *
 * スキーマと不変条件はここ（契約）に置く。YAML の読み込みと署名検証は
 * `@astra/plugin-sdk` が本スキーマを再利用して実装する。
 */
import { z } from 'zod';
import { DataSourceDecl } from './dashboard.js';
import { McpServerDecl } from './mcp.js';
import { CONFIRMATION_REQUIRED_RISKS, ExecutionSurface } from './surface.js';
import { InstallId, PluginId, PublisherId, TenantId, UserId } from './ids.js';
import { Semver, Sha256Hex, Timestamp, compareSemver } from './primitives.js';
import { ActionRisk } from './approval.js';

/** 正本 §22 の Profiles。manifest で必須。 */
export const ComplianceProfile = z.enum([
  'GENERAL',
  'ENTERPRISE',
  'REGULATED_HEALTH',
  'CARE',
  'FINANCIAL',
]);
export type ComplianceProfile = z.infer<typeof ComplianceProfile>;

/** 正本 §22 で個別 compliance gate を要する profile。manifest に policies 必須。 */
export const REGULATED_PROFILES = ['REGULATED_HEALTH', 'CARE', 'FINANCIAL'] as const;

export { ExecutionSurface, CONFIRMATION_REQUIRED_RISKS } from './surface.js';

export const PluginCategory = z.enum([
  'connector',
  'capability',
  'domain-agent',
  'skill-pack',
  'dashboard-extension',
]);
export type PluginCategory = z.infer<typeof PluginCategory>;

/**
 * 許可された permission scope の全集合。未知スコープの manifest は拒否する
 * （実装仕様 §3.6 不変条件 5）。スコープ追加は契約の変更にあたる。
 */
export const PERMISSION_SCOPES = [
  'email.read',
  'email.draft',
  'email.send',
  'contacts.read',
  'calendar.read',
  'calendar.write',
  'files.read',
  'files.write',
  'files.index',
  'drive.read',
  'drive.write',
  'microphone.capture',
  'system_audio.capture',
  'screen.capture',
  'clipboard.read',
  'artifacts.read',
  'artifacts.write',
  'web.search',
  'web.fetch',
  'code.execute',
  'crm.read',
  'crm.write',
] as const;

export const PermissionScope = z.enum(PERMISSION_SCOPES);
export type PermissionScope = z.infer<typeof PermissionScope>;

/** 承認カード必須のリスク（正本 §9.2）。manifest 検証の不変条件 1 で使う。 */

export const ToolDecl = z.object({
  id: z.string().min(1),
  risk: ActionRisk,
  surface: ExecutionSurface.default('cloud'),
  requires_confirmation: z.boolean().default(false),
});
export type ToolDecl = z.infer<typeof ToolDecl>;

export const ConnectorDecl = z.object({
  id: z.string().min(1),
  auth: z.enum(['oauth2', 'api-key', 'os-permission', 'none']),
  provider: z.string().min(1),
  scopes: z.array(z.string()).default([]),
});

export type ConnectorDecl = z.infer<typeof ConnectorDecl>;

export const AgentDecl = z.object({
  id: z.string().min(1),
  skill: z.string().min(1),
  tools: z.array(z.string()).default([]),
});

export const DashboardDecl = z.object({
  id: z.string().min(1),
  schema: z.string().min(1),
});

const manifestShape = z.object({
  id: PluginId,
  name: z.string().min(1).max(100),
  version: Semver,
  publisher: PublisherId,
  verified: z.boolean().default(false),
  min_core_version: Semver,
  category: PluginCategory,
  builtin: z.boolean().default(false),
  removable: z.boolean().default(true),
  compliance_profile: ComplianceProfile,
  execution_surfaces: z.array(ExecutionSurface).min(1),
  permissions: z.array(PermissionScope).default([]),
  /** 正本 §2.4 Plugin detail page の「data accessed」。人間可読で必須（逸脱 D-10）。 */
  data_accessed: z.array(z.string().min(1)).default([]),
  connectors: z.array(ConnectorDecl).default([]),
  tools: z.array(ToolDecl).default([]),
  agents: z.array(AgentDecl).default([]),
  dashboards: z.array(DashboardDecl).default([]),
  /** dashboard が結ぶ先。**任意の SQL は書かせない**（D-33）。 */
  data_sources: z.array(DataSourceDecl).default([]),
  /** 持ち込む MCP サーバ。risk は host が決める（正本 §9.1、D-37）。 */
  mcp_servers: z.array(McpServerDecl).default([]),
  policies: z.array(z.string()).default([]),
  data_extensions: z.array(z.string()).default([]),
  signature: z.string().optional(),
});

/**
 * manifest の不変条件（実装仕様 §3.6）。
 * スキーマだけでは表現できない横断制約をここで強制する。
 */
export const PluginManifest = manifestShape.superRefine((m, ctx) => {
  // 1. 高リスク tool は確認必須（正本 §9.2 / §22）
  for (const [i, tool] of m.tools.entries()) {
    if (
      (CONFIRMATION_REQUIRED_RISKS as readonly string[]).includes(tool.risk) &&
      !tool.requires_confirmation
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['tools', i, 'requires_confirmation'],
        message: `tool "${tool.id}" has risk ${tool.risk} and must set requires_confirmation: true`,
      });
    }
  }

  // 2. local surface の tool を持つなら execution_surfaces に local が要る
  const surfaces = new Set(m.execution_surfaces);
  for (const [i, tool] of m.tools.entries()) {
    if (!surfaces.has(tool.surface)) {
      ctx.addIssue({
        code: 'custom',
        path: ['tools', i, 'surface'],
        message: `tool "${tool.id}" declares surface "${tool.surface}" which is not in execution_surfaces`,
      });
    }
  }

  // 3. builtin は verified
  if (m.builtin && !m.verified) {
    ctx.addIssue({
      code: 'custom',
      path: ['verified'],
      message: 'builtin plugins must be verified',
    });
  }

  // 4. 規制 profile は policies 必須（正本 §22）
  if (
    (REGULATED_PROFILES as readonly string[]).includes(m.compliance_profile) &&
    m.policies.length === 0
  ) {
    ctx.addIssue({
      code: 'custom',
      path: ['policies'],
      message: `compliance_profile ${m.compliance_profile} requires at least one policy document`,
    });
  }

  // 5. agents が参照する tool は宣言済みであること
  const declaredTools = new Set(m.tools.map((t) => t.id));
  for (const [i, agent] of m.agents.entries()) {
    for (const [j, toolId] of agent.tools.entries()) {
      if (!declaredTools.has(toolId) && m.tools.length > 0) {
        ctx.addIssue({
          code: 'custom',
          path: ['agents', i, 'tools', j],
          message: `agent "${agent.id}" references undeclared tool "${toolId}"`,
        });
      }
    }
  }

  // 6. dashboard の id は重複させない（どちらが出るか決まらなくなる）
  const dashboardIds = new Set<string>();
  for (const [i, dashboard] of m.dashboards.entries()) {
    if (dashboardIds.has(dashboard.id)) {
      ctx.addIssue({
        code: 'custom',
        path: ['dashboards', i, 'id'],
        message: `duplicate dashboard id "${dashboard.id}"`,
      });
    }
    dashboardIds.add(dashboard.id);
  }

  // 7. data source の id も同様。同じ bind が 2 つの引き方を持てない。
  const sourceIds = new Set<string>();
  for (const [i, source] of m.data_sources.entries()) {
    if (sourceIds.has(source.id)) {
      ctx.addIssue({
        code: 'custom',
        path: ['data_sources', i, 'id'],
        message: `duplicate data source id "${source.id}"`,
      });
    }
    sourceIds.add(source.id);
  }

  // 8. MCP サーバの id は重複させない
  const serverIds = new Set<string>();
  for (const [i, mcp] of m.mcp_servers.entries()) {
    if (serverIds.has(mcp.id)) {
      ctx.addIssue({
        code: 'custom',
        path: ['mcp_servers', i, 'id'],
        message: `duplicate mcp server id "${mcp.id}"`,
      });
    }
    serverIds.add(mcp.id);

    // local で動く MCP を持つなら execution_surfaces に local が要る
    if (!surfaces.has(mcp.surface)) {
      ctx.addIssue({
        code: 'custom',
        path: ['mcp_servers', i, 'surface'],
        message: `mcp server "${mcp.id}" runs on "${mcp.surface}", which is not in execution_surfaces`,
      });
    }
  }

  // 9. dashboard を持つなら、結ぶ先を宣言していること。
  //    宣言の無い bind は install 後に必ず穴になる。publish で止める。
  if (m.dashboards.length > 0 && m.data_sources.length === 0) {
    ctx.addIssue({
      code: 'custom',
      path: ['data_sources'],
      message: 'a plugin with dashboards must declare the data sources they bind to',
    });
  }
});
export type PluginManifest = z.infer<typeof PluginManifest>;

/** 署名状態。UNSIGNED は Phase 0 では登録を拒否する（実装仕様 §9.2）。 */
export const SignatureState = z.enum(['VERIFIED', 'BUILTIN_TRUSTED', 'UNSIGNED']);
export type SignatureState = z.infer<typeof SignatureState>;

export const PluginCatalogEntry = z.object({
  id: PluginId,
  name: z.string(),
  publisher: PublisherId,
  verified: z.boolean(),
  category: PluginCategory,
  latest_version: Semver,
  compliance_profile: ComplianceProfile,
  builtin: z.boolean(),
  removable: z.boolean(),
  permissions: z.array(PermissionScope),
  data_accessed: z.array(z.string()),
  tool_count: z.number().int().nonnegative(),
  execution_surfaces: z.array(ExecutionSurface),
  signature_state: SignatureState,
  installed: z.boolean(),
  installed_version: Semver.nullable(),
});
export type PluginCatalogEntry = z.infer<typeof PluginCatalogEntry>;

export const InstallPluginRequest = z.object({
  version: Semver,
  /**
   * 正本 §3 Step 5「一度に全 permission を要求しない」。
   * 未許可スコープがあっても install は成立させ、そのスコープを granted=false で記録する。
   */
  granted_scopes: z.array(PermissionScope).default([]),
});
export type InstallPluginRequest = z.infer<typeof InstallPluginRequest>;

export const PluginInstall = z.object({
  id: InstallId,
  tenant_id: TenantId,
  plugin_id: PluginId,
  version: Semver,
  installed_by: UserId,
  state: z.enum(['INSTALLED', 'DISABLED', 'UNINSTALLED']),
  granted_scopes: z.array(PermissionScope),
  denied_scopes: z.array(PermissionScope),
  installed_at: Timestamp,
  updated_at: Timestamp,
});
export type PluginInstall = z.infer<typeof PluginInstall>;

export const PluginVersionRecord = z.object({
  plugin_id: PluginId,
  version: Semver,
  min_core_version: Semver,
  compliance_profile: ComplianceProfile,
  manifest_sha256: Sha256Hex,
  signature_state: SignatureState,
  published_at: Timestamp,
  yanked_at: Timestamp.nullable(),
});

/** アプリ版との互換判定。不適合は 409 plugin.incompatible。 */
export function isCompatible(minCoreVersion: string, coreVersion: string): boolean {
  return compareSemver(coreVersion, minCoreVersion) >= 0;
}
