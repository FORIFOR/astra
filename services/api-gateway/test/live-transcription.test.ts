import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { registerMeetingAudioRoute } from '../src/routes/meetings.js';

function setup(standIn = false) {
  let handler!: (socket: unknown) => void;
  let authorize!: (request: unknown, reply: unknown) => Promise<unknown>;
  const push = vi.fn(async () => [{ text: '金曜日', isFinal: false }]);
  const finish = vi.fn(async () => [{ text: '金曜日です。', isFinal: true }]);
  const start = vi.fn(async () => ({ push, finish }));
  const recordings = { append: vi.fn() };
  registerMeetingAudioRoute(
    {
      get(path: string, options: { preValidation: typeof authorize }, fn: typeof handler) {
        if (path === '/v1/transcription/live') {
          handler = fn;
          authorize = options.preValidation;
        }
      },
    } as never,
    {
      transcriber: { isStandIn: standIn, start },
      tokens: {
        verifyAccessToken: async (token: string) => {
          if (token !== 'valid') throw Error();
          return { tid: 'tenant' };
        },
      },
      recordings,
    } as never,
  );
  const socket = Object.assign(new EventEmitter(), { close: vi.fn(), send: vi.fn() });
  return { handler, authorize, socket, push, finish, recordings, start };
}
describe('live-only transcription', () => {
  it('rejects unauthenticated audio before upgrading', async () => {
    const t = setup();
    const reply = { status: vi.fn().mockReturnThis(), send: vi.fn() };
    await t.authorize({ headers: {} }, reply);
    expect(reply.status).toHaveBeenCalledWith(401);
  });
  it('returns interim results before finish, without storing or submitting audio', async () => {
    const t = setup();
    t.handler(t.socket);
    t.socket.emit('message', Buffer.alloc(6400), true);
    await vi.waitFor(() =>
      expect(t.socket.send).toHaveBeenCalledWith(
        JSON.stringify({ type: 'transcript', results: [{ text: '金曜日', isFinal: false }] }),
      ),
    );
    expect(t.finish).not.toHaveBeenCalled();
    expect(t.recordings.append).not.toHaveBeenCalled();
    t.socket.emit('message', Buffer.from('{"type":"finish"}'), false);
    await vi.waitFor(() => expect(t.socket.send).toHaveBeenCalledWith('{"type":"finished"}'));
    t.socket.emit('close');
    expect(t.finish).toHaveBeenCalledTimes(1);
  });
  it('does not open Google for a source with no audio, even on finish', async () => {
    const t = setup();
    t.handler(t.socket);
    t.socket.emit('message', Buffer.alloc(0), true);
    t.socket.emit('message', Buffer.from('{"type":"finish"}'), false);
    await vi.waitFor(() => expect(t.socket.send).toHaveBeenCalledWith('{"type":"finished"}'));
    t.socket.emit('close');
    expect(t.start).not.toHaveBeenCalled();
    expect(t.finish).not.toHaveBeenCalled();
  });
  it('closes an opened recognizer after a disconnected client', async () => {
    const t = setup();
    t.handler(t.socket);
    t.socket.emit('message', Buffer.alloc(6400), true);
    await vi.waitFor(() => expect(t.push).toHaveBeenCalledTimes(1));
    t.socket.emit('close');
    await vi.waitFor(() => expect(t.finish).toHaveBeenCalledTimes(1));
    expect(t.start).toHaveBeenCalledTimes(1);
  });
  it('rejects fake providers and oversized frames explicitly', async () => {
    const fake = setup(true);
    fake.handler(fake.socket);
    await vi.waitFor(() =>
      expect(fake.socket.close).toHaveBeenCalledWith(1011, 'transcription unavailable'),
    );
    const large = setup();
    large.handler(large.socket);
    large.socket.emit('message', Buffer.alloc(12802), true);
    expect(large.socket.close).toHaveBeenCalledWith(1011, 'transcription unavailable');
    expect(large.push).not.toHaveBeenCalled();
  });
});
