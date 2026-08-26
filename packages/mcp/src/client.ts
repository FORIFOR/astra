/**
 * MCP クライアント。正本 §9.1・§21、Phase 4 実装仕様 §7。
 *
 * **サーバは信用しない。**返ってきたものは必ず契約で検証し、
 * risk は host 側で決める（`resolveMcpTool`）。
 * MCP の tool も、manifest の tool と同じ確認を通す。
 */
import {
  AstraError,
  resolveMcpTool,
  type McpServerDecl,
  type McpToolDescriptor,
  type McpTrustState,
  type ResolvedMcpTool,
} from '@astra/contracts';
import {
  InitializeResult,
  JsonRpcResponse,
  JSONRPC_VERSION,
  PROTOCOL_VERSION,
  ToolCallResult,
  ToolsListResult,
  type McpTransportChannel,
} from './protocol.js';

export interface McpClientOptions {
  readonly server: McpServerDecl;
  readonly channel: McpTransportChannel;
  /** 正本 §21 の trust state。BLOCKED とは話さない。 */
  readonly trust?: McpTrustState;
  /** tools/list が返す件数の上限。無限に生やされないため。 */
  readonly maxTools?: number;
}

export const MAX_MCP_TOOLS = 200;

export class McpClient {
  readonly #server: McpServerDecl;
  readonly #channel: McpTransportChannel;
  readonly #trust: McpTrustState;
  readonly #maxTools: number;
  #nextId = 1;
  #initialized = false;

  constructor(options: McpClientOptions) {
    this.#server = options.server;
    this.#channel = options.channel;
    this.#trust = options.trust ?? 'UNTRUSTED';
    this.#maxTools = options.maxTools ?? MAX_MCP_TOOLS;
  }

  get trust(): McpTrustState {
    return this.#trust;
  }

  /** 版が合わない相手とは話さない。 */
  async initialize(): Promise<void> {
    if (this.#trust === 'BLOCKED') {
      throw new AstraError('plugin.permission_denied', `mcp server ${this.#server.id} is blocked`);
    }

    const result = InitializeResult.parse(
      await this.#call('initialize', {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: 'astra', version: '0.1.0' },
      }),
    );
    if (result.protocolVersion !== PROTOCOL_VERSION) {
      throw new AstraError(
        'plugin.incompatible',
        `mcp server ${this.#server.id} speaks ${result.protocolVersion}, not ${PROTOCOL_VERSION}`,
      );
    }
    this.#initialized = true;
  }

  /**
   * tool 一覧。**risk は host が付ける。**
   * サーバが「これは安全だ」と言っても、それは入力に使わない。
   */
  async listTools(): Promise<ResolvedMcpTool[]> {
    this.#requireInitialized();
    const seen = new Map<string, McpToolDescriptor>();
    let cursor: string | undefined;

    do {
      const page = ToolsListResult.parse(
        await this.#call('tools/list', cursor === undefined ? {} : { cursor }),
      );
      for (const tool of page.tools) {
        // 同じ名前を二度生やされても増やさない
        if (!seen.has(tool.name)) seen.set(tool.name, tool);
        if (seen.size >= this.#maxTools) {
          cursor = undefined;
          break;
        }
      }
      cursor = seen.size >= this.#maxTools ? undefined : page.nextCursor;
    } while (cursor !== undefined);

    return [...seen.values()].map((tool) => resolveMcpTool(this.#server, tool));
  }

  /**
   * tool を呼ぶ。
   *
   * **確認が要る tool をここで呼ばせない。**確認を取ったかどうかは
   * 呼び出し側（Action Engine）の責任なので、`approved` を明示的に受ける。
   * 既定値を true にしないのは、書き忘れが素通りになるため。
   */
  async callTool(
    name: string,
    args: Record<string, unknown>,
    context: { readonly approved: boolean },
  ): Promise<ToolCallResult> {
    this.#requireInitialized();

    const tool = (await this.listTools()).find((t) => t.name === name);
    if (!tool) {
      throw new AstraError('plugin.not_found', `mcp server ${this.#server.id} has no tool ${name}`);
    }
    if (tool.requires_confirmation && !context.approved) {
      throw new AstraError(
        'plugin.permission_denied',
        `${name} needs confirmation before it runs (risk ${tool.risk})`,
      );
    }

    const result = ToolCallResult.parse(await this.#call('tools/call', { name, arguments: args }));
    // MCP は失敗を isError で返す。**勝手に成功扱いしない**（正本 §9）。
    if (result.isError) {
      throw new AstraError('host.capability_denied', `${name} failed: ${textOf(result)}`, {
        retryable: true,
      });
    }
    return result;
  }

  async close(): Promise<void> {
    await this.#channel.close();
  }

  #requireInitialized(): void {
    if (!this.#initialized) {
      throw new AstraError(
        'host.not_connected',
        `mcp server ${this.#server.id} has not been initialized`,
      );
    }
  }

  async #call(method: string, params: Record<string, unknown>): Promise<unknown> {
    const id = this.#nextId++;
    const raw = await this.#channel.send({ jsonrpc: JSONRPC_VERSION, id, method, params });

    const response = JsonRpcResponse.parse(raw);
    if (response.id !== id) {
      // 応答の取り違えは、別の tool の結果を返すことになる
      throw new AstraError(
        'host.timeout',
        `mcp response ${String(response.id)} does not match ${id}`,
      );
    }
    if (response.error) {
      throw new AstraError(
        'host.capability_denied',
        `mcp ${method} failed: ${response.error.message}`,
      );
    }
    return response.result;
  }
}

/** 失敗の説明を取り出す。無ければ空。作り話で埋めない。 */
export function textOf(result: ToolCallResult): string {
  return result.content
    .map((c) => c.text)
    .filter((t): t is string => typeof t === 'string')
    .join(' ')
    .trim();
}
