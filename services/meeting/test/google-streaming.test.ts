/**
 * Chirp 3 の realtime。正本 §11.2 Live Path、§12.2。
 *
 * **実際には呼ばない。**呼ぶ形と、落ちたときの振る舞いを見る。
 */
import { describe, expect, it, vi } from 'vitest';
import {
  GoogleStreamingV2Transcriber,
  fromStreamingResponse,
  locationOf,
  offsetToMs,
  resolveSpeechEndpoint,
  type DuplexStream,
  type StreamState,
} from '../src/google-streaming.js';

/** 手で動かせる偽の双方向 stream。 */
function fakeStream(): DuplexStream & {
  written: unknown[];
  emitData(response: unknown): void;
  emitError(error: Error): void;
  emitEnd(): void;
  ended: boolean;
} {
  const listeners: Record<string, ((value: never) => void)[]> = {};
  const written: unknown[] = [];
  return {
    written,
    ended: false,
    write(chunk: unknown) {
      written.push(chunk);
    },
    end() {
      this.ended = true;
    },
    on(event: string, listener: (value: never) => void) {
      (listeners[event] ??= []).push(listener);
    },
    emitData(response: unknown) {
      for (const l of listeners['data'] ?? []) (l as (v: unknown) => void)(response);
    },
    emitError(error: Error) {
      for (const l of listeners['error'] ?? []) (l as (v: Error) => void)(error);
    },
    emitEnd() {
      for (const l of listeners['end'] ?? []) (l as () => void)();
    },
  };
}

const RECOGNIZER = 'projects/p/locations/us/recognizers/_';

describe('where the request goes', () => {
  it('has one place that builds the host', () => {
    // 2 箇所で組むと、片方だけ直る
    expect(resolveSpeechEndpoint('us')).toBe('us-speech.googleapis.com');
    expect(resolveSpeechEndpoint('eu')).toBe('eu-speech.googleapis.com');
    expect(resolveSpeechEndpoint('global')).toBe('speech.googleapis.com');
    expect(resolveSpeechEndpoint('')).toBe('speech.googleapis.com');
  });

  it('reads the location out of the recognizer path', () => {
    expect(locationOf(RECOGNIZER)).toBe('us');
    expect(locationOf('projects/p/locations/global/recognizers/_')).toBe('global');
    // 形が違うものを勝手に地域扱いしない
    expect(locationOf('nonsense')).toBe('global');
  });
});

describe('reading offsets', () => {
  it('accepts both the SDK object and the REST string', () => {
    expect(offsetToMs({ seconds: 4, nanos: 870_000_000 })).toBe(4_870);
    expect(offsetToMs('4.870s')).toBe(4_870);
    expect(offsetToMs(null)).toBe(0);
    expect(offsetToMs('なにか')).toBe(0);
  });
});

describe('what a response becomes', () => {
  const response = {
    results: [
      {
        alternatives: [{ transcript: 'こんにちは', confidence: 0.9 }],
        isFinal: true,
        resultEndOffset: '4.870s',
      },
    ],
  };

  it('keeps the source as the primary fact', () => {
    const [result] = fromStreamingResponse(
      response,
      { language: 'ja-JP', source: 'system' },
      { provider: 'long', fallbackUsed: false },
    );
    // 分離が無くても、どちらから来たかは残る
    expect(result!.source).toBe('system');
    expect(result!.speakerTag).toBeNull();
    expect(result!.isFinal).toBe(true);
    expect(result!.endMs).toBe(4_870);
  });

  it('does not invent a speaker number', () => {
    const [result] = fromStreamingResponse(
      response,
      { language: 'ja-JP' },
      { provider: 'long', fallbackUsed: false },
    );
    expect(result!.speakerTag).toBeNull();
  });

  it('numbers the speakers only when diarization labelled them', () => {
    const withWords = {
      results: [
        {
          alternatives: [
            {
              transcript: 'はい',
              words: [{ speakerLabel: 'spk-2', startOffset: '1s', endOffset: '2s' }],
            },
          ],
          isFinal: true,
        },
      ],
    };
    const [result] = fromStreamingResponse(
      withWords,
      { language: 'ja-JP', source: 'system' },
      { provider: 'chirp_3', fallbackUsed: false },
    );
    expect(result!.speakerTag).toBe(1);
    expect(result!.startMs).toBe(1_000);
  });

  it('drops an empty transcript instead of emitting a blank line', () => {
    const empty = { results: [{ alternatives: [{ transcript: '   ' }], isFinal: true }] };
    expect(
      fromStreamingResponse(
        empty,
        { language: 'ja-JP' },
        { provider: 'long', fallbackUsed: false },
      ),
    ).toEqual([]);
  });
});

describe('the session', () => {
  it('sends the recognizer on the config and on every audio frame', async () => {
    const stream = fakeStream();
    const transcriber = new GoogleStreamingV2Transcriber({
      recognizer: RECOGNIZER,
      client: { streamingRecognize: () => stream },
    });
    const session = await transcriber.start({ language: 'ja-JP', source: 'microphone' });
    await session.push(new Uint8Array([1, 2]), 0);

    /*
     * V2 は全メッセージに recognizer が要る。音声だけ送ると
     * `Invalid resource field value` になる（V1 は最初だけでよかった）。
     */
    expect((stream.written[0] as { recognizer: string }).recognizer).toBe(RECOGNIZER);
    expect((stream.written[1] as { recognizer: string; audio: unknown }).recognizer).toBe(
      RECOGNIZER,
    );
    expect((stream.written[1] as { audio: unknown }).audio).toBeInstanceOf(Uint8Array);
  });

  it('does not ask realtime for what only batch can give', async () => {
    const stream = fakeStream();
    const transcriber = new GoogleStreamingV2Transcriber({
      recognizer: RECOGNIZER,
      client: { streamingRecognize: () => stream },
    });
    await transcriber.start({ language: 'ja-JP', minSpeakers: 1, maxSpeakers: 4 });

    const config = stream.written[0] as {
      streamingConfig: { config: { features: Record<string, unknown> } };
    };
    // 「Chirp 3 only supports word timestamps in Recognize and BatchRecognize」
    expect(config.streamingConfig.config.features['enableWordTimeOffsets']).toBeUndefined();
    expect(config.streamingConfig.config.features['diarizationConfig']).toBeUndefined();
  });

  it('asks for interim results, because live captions need them', async () => {
    const stream = fakeStream();
    const transcriber = new GoogleStreamingV2Transcriber({
      recognizer: RECOGNIZER,
      client: { streamingRecognize: () => stream },
    });
    await transcriber.start({ language: 'ja-JP' });
    const config = stream.written[0] as {
      streamingConfig: { streamingFeatures: { interimResults: boolean } };
    };
    expect(config.streamingConfig.streamingFeatures.interimResults).toBe(true);
  });

  it('walks the lifecycle, and says so', async () => {
    const stream = fakeStream();
    const states: StreamState[] = [];
    const transcriber = new GoogleStreamingV2Transcriber({
      recognizer: RECOGNIZER,
      client: { streamingRecognize: () => stream },
      onStateChange: (state) => states.push(state),
    });
    const session = await transcriber.start({ language: 'ja-JP' });
    await session.finish();
    expect(states).toEqual(['connecting', 'streaming', 'draining', 'closed']);
  });

  it('falls back once when the model is not in this location, and tells us', async () => {
    const streams = [fakeStream(), fakeStream()];
    let opened = 0;
    const told: string[] = [];
    const transcriber = new GoogleStreamingV2Transcriber({
      recognizer: 'projects/p/locations/global/recognizers/_',
      model: 'chirp_3',
      client: {
        streamingRecognize: () => streams[opened++]!,
      },
      onFallback: (reason) => told.push(reason),
    });
    await transcriber.start({ language: 'ja-JP' });

    streams[0]!.emitError(new Error('The model "chirp_3" does not exist in the location'));
    // 作り直して long で開く。**黙って落ちない。**
    expect(opened).toBe(2);
    expect(told[0]).toContain('does not exist in the location');
    const second = streams[1]!.written[0] as { streamingConfig: { config: { model: string } } };
    expect(second.streamingConfig.config.model).toBe('long');
  });

  it('reconnects a limited number of times, then gives up loudly', async () => {
    const made: ReturnType<typeof fakeStream>[] = [];
    const transcriber = new GoogleStreamingV2Transcriber({
      recognizer: RECOGNIZER,
      maxReconnects: 1,
      client: {
        streamingRecognize: () => {
          const s = fakeStream();
          made.push(s);
          return s;
        },
      },
    });
    const session = await transcriber.start({ language: 'ja-JP' });

    made[0]!.emitError(new Error('connection reset'));
    expect(made).toHaveLength(2);
    made[1]!.emitError(new Error('connection reset again'));
    // 無限に作り直すと、料金だけが増えて音は届かない
    expect(made).toHaveLength(2);
    await expect(session.push(new Uint8Array([1]), 0)).rejects.toThrow(/again/);
  });

  it('does not send the same frame twice', async () => {
    const stream = fakeStream();
    const transcriber = new GoogleStreamingV2Transcriber({
      recognizer: RECOGNIZER,
      client: { streamingRecognize: () => stream },
    });
    const session = await transcriber.start({ language: 'ja-JP' });
    await session.push(new Uint8Array([1]), 0);
    await session.push(new Uint8Array([2]), 0);

    // 送り直すと、同じ発言が二重に字幕へ出る
    const audioMessages = stream.written.filter((m) => 'audio' in (m as object));
    expect(audioMessages).toHaveLength(2);
  });

  it('flushes what arrived after the end', async () => {
    const stream = fakeStream();
    const transcriber = new GoogleStreamingV2Transcriber({
      recognizer: RECOGNIZER,
      client: { streamingRecognize: () => stream },
    });
    const session = await transcriber.start({ language: 'ja-JP', source: 'system' });
    stream.emitData({
      results: [{ alternatives: [{ transcript: '最後の一言' }], isFinal: true }],
    });
    const results = await session.finish();
    expect(results.map((r) => r.text)).toEqual(['最後の一言']);
    expect(results[0]!.source).toBe('system');
  });

  it('refuses to start without a recognizer', () => {
    expect(
      () =>
        new GoogleStreamingV2Transcriber({
          recognizer: '',
          client: { streamingRecognize: vi.fn() },
        }),
    ).toThrow(/recognizer/);
  });
});
