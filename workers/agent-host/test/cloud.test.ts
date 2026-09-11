import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { expect, it } from 'vitest';
import { cloudClient } from '../src/cloud.js';

it('sends bodyless claims without empty JSON and handles 204 progress responses', async () => {
  const server = createServer(async (request, response) => {
    let body = '';
    for await (const part of request) body += String(part);
    if (request.headers['content-type'] === 'application/json' && !body) {
      response.writeHead(400).end();
      return;
    }
    if (request.url === '/claim') {
      response.writeHead(200, { 'content-type': 'application/json' }).end('{"job":null}');
    } else {
      expect(JSON.parse(body)).toEqual({ artifacts: 12 });
      response.writeHead(204).end();
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const cloud = cloudClient(`http://127.0.0.1:${(server.address() as AddressInfo).port}`, 'test');
    expect(await cloud('/claim', 'POST')).toEqual({ job: null });
    expect(await cloud('/progress', 'POST', { artifacts: 12 })).toBeNull();
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});
