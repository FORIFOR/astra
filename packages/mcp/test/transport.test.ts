/**
 * トランスポート。**本物の子プロセスを起動して確かめる。**
 * ここは「テストが通る」と「繋がる」がずれやすい場所なので、偽物では試さない。
 */
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { McpServerDecl } from '@astra/contracts';
import { McpClient, httpChannel, stdioChannel, PROTOCOL_VERSION } from '../src/index.js';

const SERVER = fileURLToPath(new URL('./fixtures/echo-server.mjs', import.meta.url));

const decl = McpServerDecl.parse({
  id: 'files',
  transport: 'stdio',
  command: process.execPath,
  args: [SERVER],
  tool_risks: { read_file: 'READ' },
});

const clients: { close(): Promise<void> }[] = [];
afterEach(async () => {
  for (const c of clients.splice(0)) await c.close();
});

describe('stdio', () => {
  it('talks to a real child process', async () => {
    const client = new McpClient({
      server: decl,
      channel: stdioChannel({ command: process.execPath, args: [SERVER] }),
    });
    clients.push(client);

    await client.initialize();
    const tools = await client.listTools();
    expect(tools.map((t) => t.name)).toEqual(['read_file', 'write_file']);
    // 宣言のない write_file は確認が要る
    expect(tools.find((t) => t.name === 'write_file')!.requires_confirmation).toBe(true);
  }, 30_000);

  it('does not hand the parent environment to the server', async () => {
    // `process.env` を素通しすると、こちらの資格情報が全部渡る
    process.env['MCP_LEAK_CHECK'] = 'secret-from-parent';
    try {
      const client = new McpClient({
        server: decl,
        channel: stdioChannel({ command: process.execPath, args: [SERVER] }),
      });
      clients.push(client);
      await client.initialize();
      const result = await client.callTool('read_file', {}, { approved: false });
      expect(result.content[0]!.text).toBe('no-leak');
    } finally {
      delete process.env['MCP_LEAK_CHECK'];
    }
  }, 30_000);

  it('passes only what it was explicitly given', async () => {
    const client = new McpClient({
      server: decl,
      channel: stdioChannel({
        command: process.execPath,
        args: [SERVER],
        env: { MCP_LEAK_CHECK: 'explicitly-passed' },
      }),
    });
    clients.push(client);
    await client.initialize();
    const result = await client.callTool('read_file', {}, { approved: false });
    expect(result.content[0]!.text).toBe('explicitly-passed');
  }, 30_000);

  it('gives up instead of hanging when the server never answers', async () => {
    const channel = stdioChannel({
      // 何も返さないプロセス
      command: process.execPath,
      args: ['-e', 'setInterval(() => {}, 1000)'],
      timeoutMs: 300,
    });
    await expect(
      channel.send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }),
    ).rejects.toThrow(/did not answer/);
    await channel.close();
  }, 30_000);

  it('reports a command that does not exist', async () => {
    const channel = stdioChannel({ command: '/nonexistent/mcp-server', timeoutMs: 500 });
    await expect(
      channel.send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }),
    ).rejects.toThrow();
    await channel.close();
  }, 30_000);
});

describe('http', () => {
  it('posts the request and returns the parsed answer', async () => {
    const doFetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            result: { protocolVersion: PROTOCOL_VERSION, capabilities: {} },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
    );
    const channel = httpChannel({ url: 'https://example.com/mcp', fetch: doFetch });
    const answer = await channel.send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} });
    expect(answer).toMatchObject({ id: 1 });

    const [url, init] = doFetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://example.com/mcp');
    expect(init.method).toBe('POST');
  });

  it('does not treat an error status as an answer', async () => {
    const channel = httpChannel({
      url: 'https://example.com/mcp',
      fetch: async () => new Response('nope', { status: 503 }),
    });
    await expect(
      channel.send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }),
    ).rejects.toThrow(/503/);
  });
});
