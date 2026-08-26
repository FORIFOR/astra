/**
 * MCP クライアント。正本 §9.1・§21、Phase 4 実装仕様 §7。
 *
 * ここで確かめたいのは **サーバの言い分を信用しないこと**であって、
 * JSON-RPC が喋れることではない。
 */
import { describe, expect, it, vi } from 'vitest';
import { McpServerDecl, UNKNOWN_MCP_TOOL_RISK, resolveMcpTool } from '@astra/contracts';
import { McpClient, PROTOCOL_VERSION, type McpTransportChannel } from '../src/index.js';

const server = (over: Record<string, unknown> = {}) =>
  McpServerDecl.parse({
    id: 'files',
    transport: 'stdio',
    command: '/usr/local/bin/mcp-files',
    ...over,
  });

/** 応答を順に返す偽のチャネル。 */
function channel(...responses: unknown[]): McpTransportChannel & {
  sent: Record<string, unknown>[];
} {
  const sent: Record<string, unknown>[] = [];
  let at = 0;
  return {
    sent,
    async send(request) {
      sent.push(request);
      const body = responses[Math.min(at, responses.length - 1)];
      at += 1;
      // id はこちらが振ったものを返す（取り違え検査を素通りさせるため）
      return typeof body === 'function'
        ? (body as (r: Record<string, unknown>) => unknown)(request)
        : { jsonrpc: '2.0', id: request['id'], result: body };
    },
    async close() {},
  };
}

const initOk = { protocolVersion: PROTOCOL_VERSION, capabilities: {} };

describe('risk is decided by the host', () => {
  it('treats an undeclared tool as needing confirmation, not as a read', () => {
    // ここが全体の要。書き漏らしが「READ 扱い」になってはいけない。
    const tool = resolveMcpTool(server(), { name: 'delete_everything' });
    expect(tool.risk).toBe(UNKNOWN_MCP_TOOL_RISK);
    expect(tool.requires_confirmation).toBe(true);
    expect(tool.risk_source).toBe('unknown');
  });

  it('uses the declared risk when the plugin took responsibility for it', () => {
    const tool = resolveMcpTool(server({ tool_risks: { read_file: 'READ' } }), {
      name: 'read_file',
    });
    expect(tool.risk).toBe('READ');
    expect(tool.requires_confirmation).toBe(false);
    expect(tool.risk_source).toBe('declared');
  });

  it('applies the same confirmation rule as a manifest tool', () => {
    for (const risk of ['EXTERNAL_COMMIT', 'DESTRUCTIVE', 'REGULATED', 'FINANCIAL'] as const) {
      expect(
        resolveMcpTool(server({ tool_risks: { x: risk } }), { name: 'x' }).requires_confirmation,
      ).toBe(true);
    }
    expect(
      resolveMcpTool(server({ tool_risks: { x: 'REVERSIBLE_WRITE' } }), { name: 'x' })
        .requires_confirmation,
    ).toBe(false);
  });
});

describe('the server declaration', () => {
  it('makes stdio bring a command and http bring a url', () => {
    expect(McpServerDecl.safeParse({ id: 'a', transport: 'stdio' }).success).toBe(false);
    expect(McpServerDecl.safeParse({ id: 'a', transport: 'http' }).success).toBe(false);
    expect(
      McpServerDecl.safeParse({ id: 'a', transport: 'http', url: 'https://example.com/mcp' })
        .success,
    ).toBe(true);
  });

  it('refuses to call a locally-launched server a cloud surface', () => {
    expect(
      McpServerDecl.safeParse({
        id: 'a',
        transport: 'stdio',
        command: '/bin/x',
        surface: 'cloud',
      }).success,
    ).toBe(false);
  });
});

describe('initialize', () => {
  it('refuses to talk to a blocked server at all', async () => {
    const client = new McpClient({
      server: server(),
      channel: channel(initOk),
      trust: 'BLOCKED',
    });
    await expect(client.initialize()).rejects.toThrow(/blocked/);
  });

  it('refuses a server speaking another version of the protocol', async () => {
    const client = new McpClient({
      server: server(),
      channel: channel({ protocolVersion: '1999-01-01', capabilities: {} }),
    });
    await expect(client.initialize()).rejects.toThrow(/1999-01-01/);
  });

  it('will not list tools before it has initialized', async () => {
    const client = new McpClient({ server: server(), channel: channel(initOk) });
    await expect(client.listTools()).rejects.toThrow(/not been initialized/);
  });
});

describe('listTools', () => {
  const withTools = (tools: { name: string; description?: string }[], nextCursor?: string) =>
    nextCursor === undefined ? { tools } : { tools, nextCursor };

  it('assigns risk to everything the server offers', async () => {
    const client = new McpClient({
      server: server({ tool_risks: { read_file: 'READ' } }),
      channel: channel(initOk, withTools([{ name: 'read_file' }, { name: 'write_file' }])),
    });
    await client.initialize();
    const tools = await client.listTools();

    expect(tools.map((t) => [t.name, t.risk])).toEqual([
      ['read_file', 'READ'],
      ['write_file', UNKNOWN_MCP_TOOL_RISK],
    ]);
  });

  it('does not let a server grow the same tool twice', async () => {
    const chan = channel(initOk, withTools([{ name: 'x' }, { name: 'x' }]));
    const client = new McpClient({ server: server(), channel: chan });
    await client.initialize();
    expect(await client.listTools()).toHaveLength(1);
  });

  it('stops after the cap instead of following pages forever', async () => {
    // 無限にページを生やしてくるサーバで固まらない
    let page = 0;
    const chan: McpTransportChannel = {
      async send(request) {
        const method = request['method'];
        if (method === 'initialize') {
          return { jsonrpc: '2.0', id: request['id'], result: initOk };
        }
        page += 1;
        return {
          jsonrpc: '2.0',
          id: request['id'],
          result: {
            tools: Array.from({ length: 10 }, (_, i) => ({ name: `t${page}-${i}` })),
            nextCursor: `page-${page}`,
          },
        };
      },
      async close() {},
    };
    const client = new McpClient({ server: server(), channel: chan, maxTools: 25 });
    await client.initialize();
    const tools = await client.listTools();
    expect(tools.length).toBeGreaterThanOrEqual(25);
    expect(page).toBeLessThan(10);
  });
});

describe('callTool', () => {
  const ready = (over: Record<string, unknown> = {}) =>
    new McpClient({
      server: server({ tool_risks: { read_file: 'READ', delete_file: 'DESTRUCTIVE' } }),
      channel: channel(
        initOk,
        { tools: [{ name: 'read_file' }, { name: 'delete_file' }] },
        { content: [{ type: 'text', text: 'ok' }], isError: false },
      ),
      ...over,
    });

  it('refuses a confirmation-required tool that was not approved', async () => {
    const client = ready();
    await client.initialize();
    await expect(client.callTool('delete_file', {}, { approved: false })).rejects.toThrow(
      /needs confirmation/,
    );
  });

  it('lets a read through without a confirmation', async () => {
    const client = ready();
    await client.initialize();
    const result = await client.callTool('read_file', { path: '/x' }, { approved: false });
    expect(result.isError).toBe(false);
  });

  it('refuses a tool the server never offered', async () => {
    const client = ready();
    await client.initialize();
    await expect(client.callTool('nope', {}, { approved: true })).rejects.toThrow(/has no tool/);
  });

  it('does not treat isError as success', async () => {
    // MCP は失敗を HTTP エラーではなく isError で返す（正本 §9）
    const client = new McpClient({
      server: server({ tool_risks: { read_file: 'READ' } }),
      channel: channel(
        initOk,
        { tools: [{ name: 'read_file' }] },
        { content: [{ type: 'text', text: 'permission denied' }], isError: true },
      ),
    });
    await client.initialize();
    await expect(client.callTool('read_file', {}, { approved: true })).rejects.toThrow(
      /permission denied/,
    );
  });
});

describe('the transport', () => {
  it('refuses a response whose id does not match the request', async () => {
    // 取り違えると、別の tool の結果を返すことになる
    const chan: McpTransportChannel = {
      async send() {
        return { jsonrpc: '2.0', id: 9_999, result: initOk };
      },
      async close() {},
    };
    const client = new McpClient({ server: server(), channel: chan });
    await expect(client.initialize()).rejects.toThrow(/does not match/);
  });

  it('surfaces a JSON-RPC error rather than returning nothing', async () => {
    const chan: McpTransportChannel = {
      async send(request) {
        return {
          jsonrpc: '2.0',
          id: request['id'],
          error: { code: -32_601, message: 'method not found' },
        };
      },
      async close() {},
    };
    const client = new McpClient({ server: server(), channel: chan });
    await expect(client.initialize()).rejects.toThrow(/method not found/);
  });

  it('closes the channel it was given', async () => {
    const close = vi.fn(async () => {});
    const client = new McpClient({
      server: server(),
      channel: {
        async send() {
          return {};
        },
        close,
      },
    });
    await client.close();
    expect(close).toHaveBeenCalled();
  });
});
