/**
 * MCP を tool の供給源として扱う。正本 §9.1・§21、Phase 4 実装仕様 §7。
 *
 * 要点はひとつだけ:
 *
 *   **外から来た宣言を信用しない。**MCP サーバは自分の tool の名前と説明を
 *   返してくるが、その tool が何をするか（risk）は自己申告に過ぎない。
 *   risk は **host が決める**。宣言の無い tool は「安全」ではなく
 *   「**まだ分かっていない**」として扱い、確認を要求する。
 */
import { z } from 'zod';
import { ActionRisk } from './approval.js';
import { CONFIRMATION_REQUIRED_RISKS, ExecutionSurface } from './surface.js';

/** 正本 §9.1 の local-MCP / cloud-MCP。 */
export const McpTransport = z.enum(['stdio', 'http']);
export type McpTransport = z.infer<typeof McpTransport>;

/** 正本 §21「MCP server allowlist/trust state」。 */
export const McpTrustState = z.enum(['TRUSTED', 'UNTRUSTED', 'BLOCKED']);
export type McpTrustState = z.infer<typeof McpTrustState>;

/**
 * plugin が持ち込む MCP サーバ。
 *
 * risk は**サーバごとではなく tool ごと**に host 側で決める。
 * `tool_risks` は plugin が申告する対応表で、manifest の不変条件
 *（高リスクは確認必須）が同じようにかかる。
 */
export const McpServerDecl = z
  .object({
    id: z.string().min(1).max(64),
    transport: McpTransport,
    /** stdio のとき。ローカルで起動する実行ファイル。 */
    command: z.string().min(1).max(500).optional(),
    args: z.array(z.string().max(200)).max(32).default([]),
    /** http のとき。 */
    url: z.url().optional(),
    surface: ExecutionSurface.default('local'),
    /**
     * tool 名 → risk。**ここに無い tool は「未知」**として扱う。
     * 書き漏らしが「READ 扱い」にならないようにしてある。
     */
    tool_risks: z.record(z.string(), ActionRisk).default({}),
  })
  .superRefine((server, ctx) => {
    if (server.transport === 'stdio' && !server.command) {
      ctx.addIssue({ code: 'custom', path: ['command'], message: 'stdio needs a command' });
    }
    if (server.transport === 'http' && !server.url) {
      ctx.addIssue({ code: 'custom', path: ['url'], message: 'http needs a url' });
    }
    // local で動かすものを cloud surface に置かない（逆も同じ）
    if (server.transport === 'stdio' && server.surface !== 'local') {
      ctx.addIssue({
        code: 'custom',
        path: ['surface'],
        message: 'a stdio server runs on the local host',
      });
    }
  });
export type McpServerDecl = z.infer<typeof McpServerDecl>;

/** MCP サーバが返してくる tool。**risk は入っていない。** */
export const McpToolDescriptor = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  inputSchema: z.unknown().optional(),
});
export type McpToolDescriptor = z.infer<typeof McpToolDescriptor>;

/** host が risk を決めたあとの tool。実行経路はこれしか受け取らない。 */
export const ResolvedMcpTool = z.object({
  server_id: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  risk: ActionRisk,
  requires_confirmation: z.boolean(),
  surface: ExecutionSurface,
  /** risk を plugin の申告から取ったのか、既定に落ちたのか。UI が出す。 */
  risk_source: z.enum(['declared', 'unknown']),
});
export type ResolvedMcpTool = z.infer<typeof ResolvedMcpTool>;

/**
 * 宣言の無い MCP tool の既定 risk。
 *
 * **READ にしない。**外部のサーバが何をする tool を生やしてくるかは
 * 事前に分からない。「読むだけかもしれない」で素通しすると、
 * 書き込みや送信が確認なしで通る。分からないものは確認を取る。
 */
export const UNKNOWN_MCP_TOOL_RISK: ActionRisk = 'EXTERNAL_COMMIT';

/**
 * host が risk を決める。**サーバの自己申告は入力に含めない。**
 */
export function resolveMcpTool(
  server: McpServerDecl,
  descriptor: McpToolDescriptor,
): ResolvedMcpTool {
  const declared = server.tool_risks[descriptor.name];
  const risk = declared ?? UNKNOWN_MCP_TOOL_RISK;

  return {
    server_id: server.id,
    name: descriptor.name,
    description: descriptor.description ?? null,
    risk,
    // manifest の tool と**同じ規則**をかける。外から来たものを特別扱いしない。
    requires_confirmation: (CONFIRMATION_REQUIRED_RISKS as readonly string[]).includes(risk),
    surface: server.surface,
    risk_source: declared ? 'declared' : 'unknown',
  };
}
