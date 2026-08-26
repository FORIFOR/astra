/**
 * テスト用の最小 MCP サーバ。改行区切り JSON で応答するだけ。
 * `MCP_LEAK_CHECK` を返すことで、親の環境が渡っていないかも見る。
 */
import { createInterface } from 'node:readline';

const rl = createInterface({ input: process.stdin });
rl.on('line', (line) => {
  let request;
  try {
    request = JSON.parse(line);
  } catch {
    return;
  }
  const reply = (result) =>
    process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id: request.id, result })}\n`);

  switch (request.method) {
    case 'initialize':
      reply({ protocolVersion: '2025-06-18', capabilities: {} });
      break;
    case 'tools/list':
      reply({ tools: [{ name: 'read_file' }, { name: 'write_file' }] });
      break;
    case 'tools/call':
      reply({
        content: [{ type: 'text', text: process.env.MCP_LEAK_CHECK ?? 'no-leak' }],
        isError: false,
      });
      break;
    default:
      process.stdout.write(
        `${JSON.stringify({
          jsonrpc: '2.0',
          id: request.id,
          error: { code: -32601, message: 'method not found' },
        })}\n`,
      );
  }
});
