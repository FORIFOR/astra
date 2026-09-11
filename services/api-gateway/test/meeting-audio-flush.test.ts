import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { registerMeetingAudioRoute } from '../src/routes/meetings.js';

describe('meeting audio upload receipt', () => {
  async function setup(append: (id: string, frame: Uint8Array) => Promise<void>) {
    let handler: (socket: unknown, request: unknown) => void = () => {
      throw new Error('route missing');
    };
    const app = {
      get: (_path: string, _options: unknown, fn: typeof handler) => {
        handler = fn;
      },
    };
    registerMeetingAudioRoute(
      app as never,
      {
        meetings: { get: async () => ({ language: 'ja-JP' }) },
        recordings: { append },
        logger: { warn: vi.fn() },
      } as never,
    );
    const socket = Object.assign(new EventEmitter(), { close: vi.fn(), send: vi.fn() });
    handler(socket, { meetingClaims: { tid: 'tenant' }, params: { meetingId: 'meeting' } });
    return socket;
  }
  it('acknowledges bytes only after all queued writes have finished', async () => {
    let release!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    const socket = await setup(async () => pending);
    socket.emit('message', Buffer.alloc(320), true);
    socket.emit('message', Buffer.from('{"type":"flush"}'), false);
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(socket.send).not.toHaveBeenCalled();
    release();
    await vi.waitFor(() =>
      expect(socket.send).toHaveBeenCalledWith('{"type":"flushed","bytes":320}'),
    );
  });
  it('never acknowledges a failed disk write as successful', async () => {
    const socket = await setup(async () => {
      throw new Error('disk full');
    });
    socket.emit('message', Buffer.alloc(320), true);
    socket.emit('message', Buffer.from('{"type":"flush"}'), false);
    await vi.waitFor(() =>
      expect(socket.send).toHaveBeenCalledWith('{"type":"upload_failed","bytes":0}'),
    );
  });
});
