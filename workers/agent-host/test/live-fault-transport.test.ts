import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { buildMime } from '@astra/service-connectors';
import { liveFaultTransport } from '../src/live-fault-transport.js';

describe('live accepted-send response loss', () => {
  it('cannot be enabled for production or a non-isolated account', () => {
    expect(() =>
      liveFaultTransport({ ASTRA_LIVE_FAULT_MODE: 'send-response-loss', ASTRA_ENV: 'production' }),
    ).toThrow('isolated');
    expect(liveFaultTransport({})).toBeUndefined();
  });
  it.each(['google', 'microsoft'])(
    'loses only the fixture response and counts a blocked retry: %s',
    async (provider) => {
      const directory = await mkdtemp(path.join(tmpdir(), 'astra-live-fault-'));
      try {
        const log = path.join(directory, 'fault.json');
        const real = vi.fn<typeof fetch>().mockResolvedValue(new Response('{}', { status: 200 }));
        const wrapped = liveFaultTransport(
          {
            ASTRA_LIVE_FAULT_MODE: 'send-response-loss',
            ASTRA_ENV: 'development',
            ASTRA_SECRET_STORE_FILE: path.join(directory, 'secrets'),
            ASTRA_LIVE_FAULT_NONCE: 'fixture-123',
            ASTRA_LIVE_FAULT_LOG: log,
          },
          real,
        )!;
        const url =
          provider === 'google'
            ? 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send'
            : 'https://graph.microsoft.com/v1.0/me/messages/id/reply';
        const request = {
          method: 'POST',
          body: JSON.stringify(
            provider === 'google'
              ? {
                  raw: Buffer.from(
                    buildMime({
                      to: ['fixture@example.com'],
                      subject: '検証',
                      body: '返信\n[live fixture-123]',
                    }),
                  ).toString('base64url'),
                }
              : { comment: 'reply\n[live fixture-123]' },
          ),
        };
        await expect(wrapped(url, request)).rejects.toThrow('response lost');
        expect(JSON.parse(await readFile(log, 'utf8'))).toEqual({ attempts: 1, accepted: 1 });
        await expect(wrapped(url, request)).rejects.toThrow('duplicate');
        expect(real).toHaveBeenCalledTimes(1);
        expect(JSON.parse(await readFile(log, 'utf8'))).toEqual({ attempts: 2, accepted: 1 });
        await expect(
          wrapped(url, { method: 'POST', body: JSON.stringify({ comment: 'unrelated request' }) }),
        ).resolves.toBeInstanceOf(Response);
        expect(real).toHaveBeenCalledTimes(2);
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    },
  );
});
