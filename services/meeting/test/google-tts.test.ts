/**
 * Google TTS。正本 §27・§21。
 *
 * **実際には呼ばない。**失敗の伝え方が正しいことを見る。
 */
import { describe, expect, it } from 'vitest';
import { SpeakError } from '@astra/tts';
import { GoogleTtsProvider } from '../src/google-tts.js';

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const provider = (fetchImpl: typeof globalThis.fetch, timeoutMs?: number) =>
  new GoogleTtsProvider({
    projectId: 'astra-test',
    fetch: fetchImpl,
    token: async () => 'test-token',
    ...(timeoutMs === undefined ? {} : { timeoutMs }),
  });

const speak = { text: 'こんにちは', language: 'ja-JP' };

describe('asking for speech', () => {
  it('sends the project so a user credential is not refused', async () => {
    let headers: Record<string, string> = {};
    const tts = provider(async (_url, init) => {
      headers = init?.headers as Record<string, string>;
      return json({ audioContent: Buffer.from([1, 2]).toString('base64') });
    });
    const audio = await tts.speak(speak);
    expect(headers['x-goog-user-project']).toBe('astra-test');
    expect(audio.bytes).toHaveLength(2);
  });

  it('refuses what it can refuse before the network', async () => {
    let called = false;
    const tts = provider(async () => {
      called = true;
      return json({});
    });
    await expect(tts.speak({ ...speak, text: '  ' })).rejects.toThrow(SpeakError);
    // 投げる前に断れるものは、投げる前に断る
    expect(called).toBe(false);
  });
});

describe('when the provider says no', () => {
  const failing = (status: number, message: string) =>
    provider(async () => json({ error: { message } }, status));

  it('separates permission from rate limiting', async () => {
    await expect(failing(403, 'permission denied').speak(speak)).rejects.toMatchObject({
      reason: 'permission_denied',
    });
    await expect(failing(429, 'too many requests').speak(speak)).rejects.toMatchObject({
      reason: 'rate_limited',
    });
  });

  it('separates a missing voice from a broken request', async () => {
    await expect(failing(400, 'no voice for language zz-ZZ').speak(speak)).rejects.toMatchObject({
      reason: 'unsupported_language',
    });
    await expect(failing(400, 'malformed input').speak(speak)).rejects.toMatchObject({
      reason: 'invalid_request',
    });
  });

  it('does not treat an empty reply as silence', async () => {
    const tts = provider(async () => json({}));
    // 空を無音として返すと、読み上げたことになってしまう
    await expect(tts.speak(speak)).rejects.toMatchObject({ reason: 'provider_error' });
  });

  it('does not pretend to succeed on an unreadable body', async () => {
    const tts = provider(async () => new Response('<html>502</html>', { status: 502 }));
    await expect(tts.speak(speak)).rejects.toMatchObject({ reason: 'provider_error' });
  });
});

describe('stopping', () => {
  it('reports a cancel as a cancel, not a timeout', async () => {
    const controller = new AbortController();
    const tts = provider((_url, init) => {
      const signal = init?.signal as AbortSignal;
      // 本物の fetch は、既に止まっている signal では即座に断る
      if (signal.aborted) return Promise.reject(new Error('aborted'));
      return new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(new Error('aborted')));
      });
    });
    const pending = tts.speak(speak, controller.signal);
    controller.abort();
    // 中止と時間切れは、利用者にとって別の話
    await expect(pending).rejects.toMatchObject({ reason: 'cancelled' });
  });

  it('gives up rather than waiting forever', async () => {
    const tts = provider(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          (init?.signal as AbortSignal).addEventListener('abort', () =>
            reject(new Error('timed out')),
          );
        }),
      20,
    );
    await expect(tts.speak(speak)).rejects.toMatchObject({ reason: 'timed_out' });
  });
});

describe('measuring the wait', () => {
  it('marks when it asked, when the answer started, and when the audio was whole', async () => {
    /*
     * 合計だけを測っていた間、「待たされた」という感覚が
     * **どこから来るのか**が見えなかった。体感を決めるのは
     * 最初の音が届くまでで、そこから揃うまでは別の数字。
     */
    const marks: string[] = [];
    const provider = new GoogleTtsProvider({
      projectId: 'p',
      token: async () => 't',
      onMark: (mark) => marks.push(mark),
      fetch: (async () =>
        new Response(JSON.stringify({ audioContent: Buffer.from([1, 2, 3]).toString('base64') }), {
          status: 200,
        })) as unknown as typeof globalThis.fetch,
    });

    await provider.speak({ text: 'こんにちは', language: 'ja-JP' });
    expect(marks).toEqual(['requested', 'firstAudioByte', 'audioComplete']);
  });

  it('does not mark the audio whole when nothing came back', async () => {
    // 失敗したものを、揃ったことにしない
    const marks: string[] = [];
    const provider = new GoogleTtsProvider({
      projectId: 'p',
      token: async () => 't',
      onMark: (mark) => marks.push(mark),
      fetch: (async () =>
        new Response(JSON.stringify({ audioContent: '' }), {
          status: 200,
        })) as unknown as typeof globalThis.fetch,
    });

    await expect(provider.speak({ text: 'x', language: 'ja-JP' })).rejects.toThrow();
    expect(marks).not.toContain('audioComplete');
  });
});
