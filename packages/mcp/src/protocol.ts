/**
 * MCP の JSON-RPC 部分。正本 §9.1。
 *
 * 使うのは `initialize` / `tools/list` / `tools/call` の部分集合だけ。
 * **全部を実装しない。**要らない面を持つと、そこが攻撃面になる。
 */
import { z } from 'zod';

export const JSONRPC_VERSION = '2.0';

/** MCP の版。合わない相手とは話さない。 */
export const PROTOCOL_VERSION = '2025-06-18';

export const JsonRpcResponse = z.object({
  jsonrpc: z.literal(JSONRPC_VERSION),
  id: z.union([z.string(), z.number()]),
  result: z.unknown().optional(),
  error: z
    .object({
      code: z.number(),
      message: z.string(),
      data: z.unknown().optional(),
    })
    .optional(),
});
export type JsonRpcResponse = z.infer<typeof JsonRpcResponse>;

export const InitializeResult = z.object({
  protocolVersion: z.string(),
  serverInfo: z.object({ name: z.string(), version: z.string() }).optional(),
  capabilities: z.record(z.string(), z.unknown()).default({}),
});

export const ToolsListResult = z.object({
  tools: z.array(
    z.object({
      name: z.string(),
      description: z.string().optional(),
      inputSchema: z.unknown().optional(),
    }),
  ),
  nextCursor: z.string().optional(),
});

/**
 * `tools/call` の戻り。
 *
 * MCP は「失敗」を **HTTP エラーではなく `isError`** で返してくる。
 * これを見落とすと、失敗を成功として扱ってしまう（正本 §9「勝手に成功扱いしない」）。
 */
export const ToolCallResult = z.object({
  content: z
    .array(z.object({ type: z.string(), text: z.string().optional() }).passthrough())
    .default([]),
  isError: z.boolean().default(false),
  structuredContent: z.unknown().optional(),
});
export type ToolCallResult = z.infer<typeof ToolCallResult>;

/** 1 往復を運ぶもの。stdio でも HTTP でも同じ形にする。 */
export interface McpTransportChannel {
  send(request: Record<string, unknown>): Promise<unknown>;
  close(): Promise<void>;
}
