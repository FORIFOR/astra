/**
 * Google STT を使うときの取り決め。正本 §11.2、Phase 3 §1.1。
 * Google は呼ばない。**応答の写し取り方**だけを確かめる。
 */
import { describe, expect, it, vi } from 'vitest';
import {
  GoogleBatchTranscriber,
  GoogleStreamingTranscriber,
  durationToMs,
  fromV1Response,
  fromV2Results,
  type DuplexLike,
  type V1StreamingResponse,
} from '../src/google.js';

describe('durationToMs', () => {
  it('takes seconds as a string, the way protobuf sends them', () => {
    expect(durationToMs({ seconds: '3', nanos: 500_000_000 })).toBe(3_500);
    expect(durationToMs({ seconds: 2 })).toBe(2_000);
    expect(durationToMs(null)).toBe(0);
  });
});

describe('fromV1Response', () => {
  type V1Result = NonNullable<V1StreamingResponse['results']>[number];

  const response = (over: Partial<V1Result> = {}) =>
    ({
      results: [
        {
          isFinal: true,
          resultEndTime: { seconds: 4 },
          alternatives: [
            {
              transcript: '初期費用が気になります',
              confidence: 0.92,
              words: [
                {
                  word: '初期費用',
                  speakerTag: 2,
                  startTime: { seconds: 1 },
                  endTime: { seconds: 2 },
                },
                { word: 'が', speakerTag: 2, startTime: { seconds: 2 }, endTime: { seconds: 3 } },
                {
                  word: '気になります',
                  speakerTag: 1,
                  startTime: { seconds: 3 },
                  endTime: { seconds: 4 },
                },
              ],
            },
          ],
          ...over,
        },
      ],
    }) as V1StreamingResponse;

  it('gives the segment to whoever spoke most of it', () => {
    // 単語ごとに行を割ると、読めない断片の羅列になる
    const [result] = fromV1Response(response(), 'ja-JP');
    expect(result!.speakerTag).toBe(2);
    expect(result!.text).toBe('初期費用が気になります');
    expect(result!.startMs).toBe(1_000);
    expect(result!.endMs).toBe(4_000);
    expect(result!.confidence).toBe(0.92);
    expect(result!.isFinal).toBe(true);
  });

  it('marks an unsettled result as interim rather than dropping it', () => {
    const [result] = fromV1Response(response({ isFinal: false }), 'ja-JP');
    expect(result!.isFinal).toBe(false);
  });

  it('leaves the speaker unknown rather than guessing one', () => {
    const [result] = fromV1Response(
      {
        results: [
          {
            isFinal: true,
            resultEndTime: { seconds: 1 },
            alternatives: [{ transcript: '何か', words: [] }],
          },
        ],
      },
      'ja-JP',
    );
    expect(result!.speakerTag).toBeNull();
  });

  it('skips empty transcripts instead of storing blank lines', () => {
    expect(
      fromV1Response(
        { results: [{ isFinal: true, alternatives: [{ transcript: '   ' }] }] },
        'ja-JP',
      ),
    ).toEqual([]);
  });
});

describe('GoogleStreamingTranscriber', () => {
  const fakeStream = () => {
    const listeners: Record<string, ((value: never) => void)[]> = {};
    const written: unknown[] = [];
    const stream: DuplexLike = {
      write: (chunk) => void written.push(chunk),
      end: () => listeners['end']?.forEach((l) => l(undefined as never)),
      on: (event: string, listener: (value: never) => void) => {
        (listeners[event] ??= []).push(listener);
      },
    } as DuplexLike;
    return {
      stream,
      written,
      emit: (event: string, value?: unknown) => listeners[event]?.forEach((l) => l(value as never)),
    };
  };

  it('sends the config first, with diarization on', async () => {
    const fake = fakeStream();
    const session = await new GoogleStreamingTranscriber({
      client: { streamingRecognize: () => fake.stream },
    }).start({ language: 'ja-JP', minSpeakers: 2, maxSpeakers: 5 });

    const inner = (
      fake.written[0] as {
        streamingConfig: {
          config: { diarizationConfig: Record<string, unknown>; languageCode: string };
          interimResults: boolean;
        };
      }
    ).streamingConfig;
    // Chirp 3 は streaming で diarization を出せないので live は V1（正本 §11.2）
    expect(inner.config.diarizationConfig).toMatchObject({
      enableSpeakerDiarization: true,
      minSpeakerCount: 2,
      maxSpeakerCount: 5,
    });
    expect(inner.interimResults).toBe(true);
    expect(inner.config.languageCode).toBe('ja-JP');
    expect(session).toBeDefined();
  });

  it('does not block pushing audio while waiting for results', async () => {
    const fake = fakeStream();
    const session = await new GoogleStreamingTranscriber({
      client: { streamingRecognize: () => fake.stream },
    }).start({ language: 'ja-JP' });

    // まだ何も返ってきていなくても push は通る（止めると音が遅れて会議が破綻する）
    expect(await session.push(new Uint8Array(3_200), 100)).toEqual([]);

    fake.emit('data', {
      results: [
        {
          isFinal: true,
          resultEndTime: { seconds: 1 },
          alternatives: [{ transcript: 'あとから届く', words: [{ speakerTag: 1 }] }],
        },
      ],
    });
    const results = await session.push(new Uint8Array(3_200), 200);
    expect(results.map((r) => r.text)).toEqual(['あとから届く']);
    // 一度渡したものを二度渡さない
    expect(await session.push(new Uint8Array(3_200), 300)).toEqual([]);
  });

  it('surfaces a stream error instead of going quiet', async () => {
    const fake = fakeStream();
    const session = await new GoogleStreamingTranscriber({
      client: { streamingRecognize: () => fake.stream },
    }).start({ language: 'ja-JP' });

    fake.emit('error', new Error('stt unavailable'));
    // 呼び出し側（gateway）はこれを掴んで degraded にし、録音は続ける
    await expect(session.push(new Uint8Array(8), 100)).rejects.toThrow(/stt unavailable/);
  });
});

describe('fromV2Results', () => {
  it('renumbers speaker labels in the order they appear', () => {
    // 番号そのものに意味を持たせない。突き合わせは時間で行う。
    const results = fromV2Results(
      [
        {
          resultEndOffset: { seconds: 2 },
          alternatives: [
            {
              transcript: 'こちらから',
              words: [{ speakerLabel: 'speaker_7', startOffset: { seconds: 0 } }],
            },
          ],
        },
        {
          resultEndOffset: { seconds: 4 },
          alternatives: [
            {
              transcript: 'では次に',
              words: [{ speakerLabel: 'speaker_2', startOffset: { seconds: 2 } }],
            },
          ],
        },
      ],
      'ja-JP',
    );
    expect(results.map((r) => r.speakerTag)).toEqual([1, 2]);
    expect(results.every((r) => r.isFinal)).toBe(true);
  });
});

describe('GoogleBatchTranscriber', () => {
  it('needs a recognizer path, since the project is not decided here', () => {
    expect(
      () => new GoogleBatchTranscriber({ client: { recognize: vi.fn() }, recognizer: '' }),
    ).toThrow(/recognizer/);
  });

  it('does not call Google for an empty recording', async () => {
    const recognize = vi.fn();
    const batch = new GoogleBatchTranscriber({
      client: { recognize },
      recognizer: 'projects/p/locations/global/recognizers/_',
    });
    expect(await batch.transcribe(new Uint8Array(0), { language: 'ja-JP' })).toEqual([]);
    expect(recognize).not.toHaveBeenCalled();
  });

  it('asks for a model that is actually available, with word timings', async () => {
    const recognize = vi.fn(async () => [{ results: [] }] as never);
    const batch = new GoogleBatchTranscriber({
      client: { recognize },
      recognizer: 'projects/p/locations/global/recognizers/_',
    });
    await batch.transcribe(new Uint8Array(16), { language: 'ja-JP' });

    const [request] = recognize.mock.calls[0] as unknown as [
      { config: { model: string; features: { enableWordTimeOffsets: boolean } } },
    ];
    /*
     * 正本 §11.2 は Chirp 3 を指名しているが、実接続で確かめたところ
     * **一般提供が終わっていた**（no longer generally available）。
     * 使えないものを既定にすると、繋いだ瞬間に 403 で落ちる。
     * 指定したい場合は `model` で明示できる。
     */
    expect(request.config.model).toBe('long');
    // 時間が無いと live との突き合わせができない
    expect(request.config.features.enableWordTimeOffsets).toBe(true);
  });

  it('still lets the caller name a model explicitly', async () => {
    const recognize = vi.fn(async () => [{ results: [] }] as never);
    const batch = new GoogleBatchTranscriber({
      client: { recognize },
      recognizer: 'r',
      model: 'chirp_3',
    });
    await batch.transcribe(new Uint8Array(16), { language: 'ja-JP' });
    const [request] = recognize.mock.calls[0] as unknown as [{ config: { model: string } }];
    expect(request.config.model).toBe('chirp_3');
  });
});

describe('GoogleTranslationProvider', () => {
  it('drops the region before asking, and needs a parent path', async () => {
    const { GoogleTranslationProvider, baseLanguage } = await import('../src/google.js');
    expect(baseLanguage('ja-JP')).toBe('ja');
    expect(
      () => new GoogleTranslationProvider({ client: { translateText: vi.fn() }, parent: '' }),
    ).toThrow(/parent/);

    const translateText = vi.fn(
      async () => [{ translations: [{ translatedText: 'Sales' }] }] as never,
    );
    const provider = new GoogleTranslationProvider({
      client: { translateText },
      parent: 'projects/p/locations/global',
    });
    expect(await provider.translate('売上', 'ja-JP', 'en-US')).toBe('Sales');
    const [translateRequest] = translateText.mock.calls[0] as unknown as [Record<string, unknown>];
    expect(translateRequest).toMatchObject({
      sourceLanguageCode: 'ja',
      targetLanguageCode: 'en',
    });
  });

  it('returns nothing rather than passing the original off as a translation', async () => {
    const { GoogleTranslationProvider } = await import('../src/google.js');
    const provider = new GoogleTranslationProvider({
      client: { translateText: vi.fn(async () => [{ translations: [] }] as never) },
      parent: 'projects/p/locations/global',
    });
    expect(await provider.translate('売上', 'ja-JP', 'en-US')).toBe('');
    expect(await provider.translate('   ', 'ja-JP', 'en-US')).toBe('');
  });
});
