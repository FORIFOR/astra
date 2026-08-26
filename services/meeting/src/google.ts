/**
 * Google Speech-to-Text を STT に使う。正本 §11.2、Phase 3 実装仕様 §1.1（OQ-11）。
 *
 * 正本が決めた二重経路をそのまま写す:
 *
 *   live  … V1 Streaming + `enableSpeakerDiarization`（Chirp 3 は streaming で
 *           diarization を出せないため、live は V1 側に置く）
 *   final … V2 Chirp 3 `BatchRecognize`（精度優先）
 *
 * **クライアントは差し替え口にしてある。**テストは Google を呼ばない。
 * 認証情報（どの GCP プロジェクトか）は未決なので、ここでは決め打ちしない。
 */
import type {
  BatchTranscriber,
  StreamingConfig,
  StreamingSession,
  StreamingTranscriber,
  TranscriptResult,
  TranslationProvider,
} from './providers.js';

/**
 * V1 の streaming 応答のうち、こちらが使う部分だけ。
 * 依存の型をそのまま持ち込むと、ライブラリの版で壁が動く。
 */
export interface V1StreamingResponse {
  readonly results?: readonly {
    readonly isFinal?: boolean | null;
    readonly alternatives?:
      | readonly {
          readonly transcript?: string | null;
          readonly confidence?: number | null;
          readonly words?:
            | readonly {
                readonly speakerTag?: number | null;
                readonly word?: string | null;
                readonly startTime?: {
                  seconds?: number | string | null;
                  nanos?: number | null;
                } | null;
                readonly endTime?: {
                  seconds?: number | string | null;
                  nanos?: number | null;
                } | null;
              }[]
            | null;
        }[]
      | null;
    readonly resultEndTime?: { seconds?: number | string | null; nanos?: number | null } | null;
  }[];
}

/** 双方向ストリームの最小面。`@google-cloud/speech` の streamingRecognize が満たす。 */
export interface DuplexLike {
  write(chunk: unknown): void;
  end(): void;
  on(event: 'data', listener: (response: V1StreamingResponse) => void): void;
  on(event: 'error', listener: (error: Error) => void): void;
  on(event: 'end', listener: () => void): void;
}

export interface V1SpeechClient {
  streamingRecognize(): DuplexLike;
}

export interface GoogleStreamingConfig {
  /** `new SpeechClient()` を渡す。ここで作らないのは、認証の面倒を持ち込まないため。 */
  readonly client: V1SpeechClient;
  readonly sampleRateHz?: number;
  readonly encoding?: string;
}

/** ミリ秒へ直す。protobuf の Duration は seconds が文字列で来ることがある。 */
export function durationToMs(
  value: { seconds?: number | string | null; nanos?: number | null } | null | undefined,
): number {
  if (!value) return 0;
  const seconds = typeof value.seconds === 'string' ? Number(value.seconds) : (value.seconds ?? 0);
  return Math.round(seconds * 1000 + (value.nanos ?? 0) / 1e6);
}

/**
 * V1 の応答を `TranscriptResult` へ写す。
 *
 * V1 は **単語ごとに** speaker tag を返す。segment の話者は
 * 「その区間でいちばん多く喋った話者」にする。単語ごとに行を割ると、
 * 会話が読めない断片の羅列になる。
 */
export function fromV1Response(
  response: V1StreamingResponse,
  language: string,
): TranscriptResult[] {
  const out: TranscriptResult[] = [];

  for (const result of response.results ?? []) {
    const alternative = result.alternatives?.[0];
    if (!alternative) continue;
    const text = (alternative.transcript ?? '').trim();
    if (text.length === 0) continue;

    const words = alternative.words ?? [];
    const counts = new Map<number, number>();
    for (const word of words) {
      if (typeof word.speakerTag === 'number' && word.speakerTag > 0) {
        counts.set(word.speakerTag, (counts.get(word.speakerTag) ?? 0) + 1);
      }
    }
    let speakerTag: number | null = null;
    let best = 0;
    for (const [tag, count] of counts) {
      // 同数なら小さい番号。実行ごとに話者が入れ替わらないようにする。
      if (count > best || (count === best && speakerTag !== null && tag < speakerTag)) {
        speakerTag = tag;
        best = count;
      }
    }

    const endMs = durationToMs(result.resultEndTime ?? words.at(-1)?.endTime);
    const startMs = words.length > 0 ? durationToMs(words[0]!.startTime) : Math.max(0, endMs);

    out.push({
      isFinal: result.isFinal === true,
      speakerTag,
      text,
      startMs,
      endMs: Math.max(startMs, endMs),
      language,
      confidence: typeof alternative.confidence === 'number' ? alternative.confidence : null,
    });
  }
  return out;
}

/**
 * live の経路。V1 Streaming + diarization。
 *
 * gRPC の双方向ストリームは push と結果が非同期なので、
 * 届いた結果を溜めておき、次の `push` / `finish` で引き渡す。
 * **結果を待って push を止めない**（止めると音が遅れ、会議が破綻する）。
 */
export class GoogleStreamingTranscriber implements StreamingTranscriber {
  readonly isStandIn = false;
  readonly #config: GoogleStreamingConfig;

  constructor(config: GoogleStreamingConfig) {
    this.#config = config;
  }

  async start(config: StreamingConfig): Promise<StreamingSession> {
    const stream = this.#config.client.streamingRecognize();
    const pending: TranscriptResult[] = [];
    let failure: Error | null = null;
    let ended = false;

    stream.on('data', (response) => {
      pending.push(...fromV1Response(response, config.language));
    });
    stream.on('error', (error) => {
      failure = error;
    });
    stream.on('end', () => {
      ended = true;
    });

    // 最初のメッセージは設定。以降が音声（V1 の約束）。
    stream.write({
      streamingConfig: {
        config: {
          encoding: this.#config.encoding ?? 'LINEAR16',
          sampleRateHertz: this.#config.sampleRateHz ?? 16_000,
          languageCode: config.language,
          enableAutomaticPunctuation: true,
          diarizationConfig: {
            enableSpeakerDiarization: true,
            ...(config.minSpeakers === undefined ? {} : { minSpeakerCount: config.minSpeakers }),
            ...(config.maxSpeakers === undefined ? {} : { maxSpeakerCount: config.maxSpeakers }),
          },
        },
        interimResults: true,
      },
    });

    const drain = (): TranscriptResult[] => {
      if (failure) throw failure;
      return pending.splice(0, pending.length);
    };

    return {
      async push(frame) {
        if (failure) throw failure;
        if (!ended) stream.write({ audioContent: frame });
        return drain();
      },
      async finish() {
        if (!ended) stream.end();
        // end のあとに残りが届くので、一巡だけ待つ
        await new Promise((resolve) => setImmediate(resolve));
        return drain();
      },
    };
  }
}

// ------------------------------------------------------------------ batch

/** V2 の認識結果のうち、こちらが使う部分だけ。 */
export interface V2Result {
  readonly alternatives?:
    | readonly {
        readonly transcript?: string | null;
        readonly confidence?: number | null;
        readonly words?:
          | readonly {
              readonly speakerLabel?: string | null;
              readonly startOffset?: {
                seconds?: number | string | null;
                nanos?: number | null;
              } | null;
              readonly endOffset?: {
                seconds?: number | string | null;
                nanos?: number | null;
              } | null;
            }[]
          | null;
      }[]
    | null;
  readonly resultEndOffset?: { seconds?: number | string | null; nanos?: number | null } | null;
}

export interface V2SpeechClient {
  /** `BatchRecognize` の戻り。長時間実行なので promise の配列で返る。 */
  recognize(request: unknown): Promise<[{ results?: readonly V2Result[] | null }, ...unknown[]]>;
}

export interface GoogleBatchConfig {
  readonly client: V2SpeechClient;
  /** `projects/<id>/locations/<loc>/recognizers/_` の形。未決なので必須にする。 */
  readonly recognizer: string;
  readonly model?: string;
  readonly sampleRateHz?: number;
}

/**
 * V2 は話者を**ラベル文字列**で返す。番号へ直す必要があるが、
 * 数字でないラベルも来るので、出現順に 1 から振り直す。
 * **番号そのものに意味を持たせない**（突き合わせは時間で行う）。
 */
export function fromV2Results(results: readonly V2Result[], language: string): TranscriptResult[] {
  const tags = new Map<string, number>();
  const tagOf = (label: string | null | undefined): number | null => {
    if (!label) return null;
    const existing = tags.get(label);
    if (existing !== undefined) return existing;
    const next = tags.size + 1;
    tags.set(label, next);
    return next;
  };

  const out: TranscriptResult[] = [];
  for (const result of results) {
    const alternative = result.alternatives?.[0];
    if (!alternative) continue;
    const text = (alternative.transcript ?? '').trim();
    if (text.length === 0) continue;

    const words = alternative.words ?? [];
    const counts = new Map<number, number>();
    for (const word of words) {
      const tag = tagOf(word.speakerLabel);
      if (tag !== null) counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
    let speakerTag: number | null = null;
    let best = 0;
    for (const [tag, count] of counts) {
      if (count > best || (count === best && speakerTag !== null && tag < speakerTag)) {
        speakerTag = tag;
        best = count;
      }
    }

    const endMs = durationToMs(result.resultEndOffset ?? words.at(-1)?.endOffset);
    const startMs = words.length > 0 ? durationToMs(words[0]!.startOffset) : Math.max(0, endMs);

    out.push({
      isFinal: true,
      speakerTag,
      text,
      startMs,
      endMs: Math.max(startMs, endMs),
      language,
      confidence: typeof alternative.confidence === 'number' ? alternative.confidence : null,
    });
  }
  return out;
}

export class GoogleBatchTranscriber implements BatchTranscriber {
  readonly isStandIn = false;
  readonly #config: GoogleBatchConfig;

  constructor(config: GoogleBatchConfig) {
    if (!config.recognizer) throw new Error('a Google recognizer path is required');
    this.#config = config;
  }

  async transcribe(
    audio: Uint8Array,
    config: StreamingConfig,
  ): Promise<readonly TranscriptResult[]> {
    if (audio.byteLength === 0) return [];

    const [response] = await this.#config.client.recognize({
      recognizer: this.#config.recognizer,
      config: {
        // Chirp 3。正本 §11.2 が精度側に指定したモデル。
        model: this.#config.model ?? 'chirp_3',
        languageCodes: [config.language],
        features: {
          enableAutomaticPunctuation: true,
          enableWordTimeOffsets: true,
          diarizationConfig: {
            ...(config.minSpeakers === undefined ? {} : { minSpeakerCount: config.minSpeakers }),
            ...(config.maxSpeakers === undefined ? {} : { maxSpeakerCount: config.maxSpeakers }),
          },
        },
        explicitDecodingConfig: {
          encoding: 'LINEAR16',
          sampleRateHertz: this.#config.sampleRateHz ?? 16_000,
          audioChannelCount: 1,
        },
      },
      content: audio,
    });

    return fromV2Results(response.results ?? [], config.language);
  }
}

// ------------------------------------------------------------- translation

export interface TranslateClient {
  translateText(
    request: unknown,
  ): Promise<
    [{ translations?: readonly { translatedText?: string | null }[] | null }, ...unknown[]]
  >;
}

export interface GoogleTranslationConfig {
  readonly client: TranslateClient;
  /** `projects/<id>/locations/<loc>` の形。 */
  readonly parent: string;
}

/**
 * 確定 segment の翻訳。正本 §12.2 は
 * **diarized text → Translation の分離 pipeline** を正本と決めている
 * （speech translation を使うと speaker tag の連続性が保てないため）。
 */
export class GoogleTranslationProvider implements TranslationProvider {
  readonly isStandIn = false;
  readonly #config: GoogleTranslationConfig;

  constructor(config: GoogleTranslationConfig) {
    if (!config.parent) throw new Error('a Google translation parent path is required');
    this.#config = config;
  }

  async translate(text: string, from: string, to: string): Promise<string> {
    if (text.trim().length === 0) return '';
    const [response] = await this.#config.client.translateText({
      parent: this.#config.parent,
      contents: [text],
      mimeType: 'text/plain',
      // `ja-JP` のような地域付きでも通るよう、言語部分だけ渡す
      ...(from === 'auto' ? {} : { sourceLanguageCode: baseLanguage(from) }),
      targetLanguageCode: baseLanguage(to),
    });

    const translated = response.translations?.[0]?.translatedText;
    // 訳せなかったときに原文を訳文として出さない。空で返し、UI は原文だけを見せる。
    return typeof translated === 'string' ? translated : '';
  }
}

/** `ja-JP` → `ja`。翻訳 API は地域を要求しない。 */
export function baseLanguage(code: string): string {
  return code.split('-')[0] ?? code;
}
