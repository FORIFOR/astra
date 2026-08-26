/**
 * Chirp 3 の realtime。正本 §11.2 Live Path、§12.2。
 *
 * **Batch を realtime に流用しない。**別実装にしてある理由:
 *
 *   - Batch は録音全体を渡す。realtime は届いた分から返す
 *   - Batch は精度優先、realtime は遅延優先。落とすものが違う
 *   - 混ぜると、片方を直したときにもう片方が壊れる
 *
 * **出所が一次情報。**マイクと相手側は別の流れにし、
 * 混ぜてから起こさない（混ぜると誰の発言か言えなくなる）。
 */
import type {
  StreamingConfig,
  StreamingSession,
  StreamingTranscriber,
  TranscriptResult,
} from './providers.js';

/** 会話の状態。**「繋いでいる」と「流している」を分ける。** */
export const STREAM_STATES = [
  'idle',
  'connecting',
  'streaming',
  'reconnecting',
  'draining',
  'closed',
] as const;
export type StreamState = (typeof STREAM_STATES)[number];

/** location から endpoint を導く**唯一の入口**。あちこちで組み立てない。 */
export function resolveSpeechEndpoint(location: string): string {
  return !location || location === 'global'
    ? 'speech.googleapis.com'
    : `${location}-speech.googleapis.com`;
}

/** recognizer のパスから location を取り出す。 */
export function locationOf(recognizer: string): string {
  return /\/locations\/([^/]+)/.exec(recognizer)?.[1] ?? 'global';
}

/** SDK の双方向 stream のうち、こちらが使う分だけ。 */
export interface DuplexStream {
  write(chunk: unknown): void;
  end(): void;
  destroy?(error?: Error): void;
  on(event: 'data', listener: (response: unknown) => void): void;
  on(event: 'error', listener: (error: Error) => void): void;
  on(event: 'end', listener: () => void): void;
}

export interface StreamingSpeechClient {
  streamingRecognize(): DuplexStream;
}

export interface GoogleStreamingV2Config {
  readonly client: StreamingSpeechClient;
  /** `projects/<id>/locations/<loc>/recognizers/_` の形。 */
  readonly recognizer: string;
  readonly model?: string;
  readonly fallbackModel?: string;
  readonly sampleRateHz?: number;
  /** 落ちたときに作り直す回数。0 なら作り直さない。 */
  readonly maxReconnects?: number;
  readonly onFallback?: (reason: string) => void;
  readonly onStateChange?: (state: StreamState) => void;
}

/** V2 streaming の応答のうち、こちらが使う部分。 */
interface V2StreamingResponse {
  readonly results?:
    | readonly {
        readonly alternatives?:
          | readonly {
              readonly transcript?: string | null;
              readonly confidence?: number | null;
              readonly words?:
                | readonly {
                    readonly speakerLabel?: string | null;
                    readonly startOffset?: unknown;
                    readonly endOffset?: unknown;
                  }[]
                | null;
            }[]
          | null;
        readonly isFinal?: boolean | null;
        readonly resultEndOffset?: unknown;
      }[]
    | null;
}

/** duration を ms へ。SDK は `{seconds,nanos}`、REST は `"4.870s"`。 */
export function offsetToMs(value: unknown): number {
  if (value === null || value === undefined) return 0;
  if (typeof value === 'string') {
    const seconds = Number(value.endsWith('s') ? value.slice(0, -1) : value);
    return Number.isFinite(seconds) ? Math.round(seconds * 1000) : 0;
  }
  const record = value as { seconds?: number | string | null; nanos?: number | null };
  const seconds =
    typeof record.seconds === 'string' ? Number(record.seconds) : (record.seconds ?? 0);
  return Math.round((Number.isFinite(seconds) ? seconds : 0) * 1000 + (record.nanos ?? 0) / 1e6);
}

/**
 * 応答を `TranscriptResult` へ写す。
 *
 * **話者は分離が付けたときだけ。**付いていなければ null のままにする
 * （出所が一次情報なので、番号を作る必要が無い）。
 */
export function fromStreamingResponse(
  response: unknown,
  config: StreamingConfig,
  meta: { provider: string; fallbackUsed: boolean },
): TranscriptResult[] {
  const parsed = response as V2StreamingResponse;
  const out: TranscriptResult[] = [];

  for (const result of parsed.results ?? []) {
    const alternative = result.alternatives?.[0];
    if (!alternative) continue;
    const text = (alternative.transcript ?? '').trim();
    if (text.length === 0) continue;

    const words = alternative.words ?? [];
    // 分離が返した番号。文字列ラベルを出現順に 1 から振り直す。
    const labels = new Map<string, number>();
    let speakerTag: number | null = null;
    for (const word of words) {
      const label = word.speakerLabel;
      if (!label) continue;
      if (!labels.has(label)) labels.set(label, labels.size + 1);
      speakerTag ??= labels.get(label) ?? null;
    }

    const endMs = offsetToMs(result.resultEndOffset ?? words.at(-1)?.endOffset);
    const startMs = words.length > 0 ? offsetToMs(words[0]?.startOffset) : Math.max(0, endMs);

    out.push({
      isFinal: result.isFinal === true,
      speakerTag,
      text,
      startMs,
      endMs,
      language: config.language,
      confidence: alternative.confidence ?? null,
      ...(config.source === undefined ? {} : { source: config.source }),
      provider: meta.provider,
      fallbackUsed: meta.fallbackUsed,
    });
  }
  return out;
}

/** そのモデルがこの location に無いか。 */
function isModelUnavailable(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /does not exist in the location|no longer generally available|not.*available/i.test(
    message,
  );
}

export class GoogleStreamingV2Transcriber implements StreamingTranscriber {
  readonly isStandIn = false;
  readonly #config: GoogleStreamingV2Config;

  constructor(config: GoogleStreamingV2Config) {
    if (!config.recognizer) throw new Error('a Google recognizer path is required');
    this.#config = config;
  }

  async start(config: StreamingConfig): Promise<StreamingSession> {
    const deps = this.#config;
    /*
     * **live は `long`、精度は batch の Chirp 3。**正本 §11.2 の二段構成。
     *
     * 実測（同じ 14 秒の音声・100ms ずつ送信）:
     *   chirp_3  途中経過 0 件 / 確定 2 件
     *   long     途中経過 26 件（最初 2678ms）/ 確定 2 件
     *
     * Chirp 3 は streaming で途中経過を返さない。会議中は
     * **確定まで画面に何も出ない**ことになり、§12.4 の live transcript が
     * 成り立たない。live は途中経過が出るほうを採り、
     * 語の時刻・話者・精度は会議後の batch（Chirp 3）で足す。
     */
    const preferred = deps.model ?? 'long';
    const fallback = deps.fallbackModel ?? 'long';
    const maxReconnects = deps.maxReconnects ?? 2;

    let model = preferred;
    let fallbackUsed = false;
    let state: StreamState = 'idle';
    let stream: DuplexStream | null = null;
    let failure: Error | null = null;
    let ended = false;
    let reconnects = 0;
    const pending: TranscriptResult[] = [];
    /** 送った frame の番号。**作り直しても振り直さない**（重複の判定に使う）。 */
    let nextSequence = 0;
    const sent = new Set<number>();

    const setState = (next: StreamState): void => {
      state = next;
      deps.onStateChange?.(next);
    };

    const configMessage = (): unknown => ({
      recognizer: deps.recognizer,
      streamingConfig: {
        config: {
          model,
          languageCodes: [config.language],
          /*
           * **realtime では語単位の時刻も話者分離も頼まない。**
           *
           *   「Chirp 3 only supports word timestamps in Recognize and
           *     BatchRecognize requests.」
           *
           * 頼むと stream ごと落ちる。realtime で要るのは遅延の小ささで、
           * 語の時刻と話者は会議後の batch で足す（正本 §11.2 の二段構成）。
           * realtime の話者は `source`（マイク / 相手側）が受け持つ。
           */
          features: { enableAutomaticPunctuation: true },
          explicitDecodingConfig: {
            encoding: 'LINEAR16',
            sampleRateHertz: deps.sampleRateHz ?? 16_000,
            audioChannelCount: 1,
          },
        },
        streamingFeatures: { interimResults: true },
      },
    });

    const open = (): void => {
      setState(state === 'idle' ? 'connecting' : 'reconnecting');
      const next = deps.client.streamingRecognize();
      next.on('data', (response) => {
        pending.push(...fromStreamingResponse(response, config, { provider: model, fallbackUsed }));
      });
      next.on('error', (error) => {
        /*
         * モデルが無い location なら、1 度だけ落として作り直す。
         * **黙って落ちない。**落ちたことを呼び出し側へ知らせる。
         */
        if (isModelUnavailable(error) && model === preferred && fallback !== preferred) {
          model = fallback;
          fallbackUsed = true;
          deps.onFallback?.(error.message);
          stream = null;
          open();
          return;
        }
        /*
         * それ以外は作り直しを試す。**回数を切る。**
         * 無限に作り直すと、料金だけが増えて音は届かない。
         */
        if (reconnects < maxReconnects && !ended) {
          reconnects += 1;
          stream = null;
          open();
          return;
        }
        failure = error;
        setState('closed');
      });
      next.on('end', () => {
        ended = true;
        setState('closed');
      });

      // 最初のメッセージは設定。以降が音声（V2 の約束）。
      next.write(configMessage());
      stream = next;
      setState('streaming');
    };

    open();

    const drain = (): TranscriptResult[] => {
      if (failure) throw failure;
      return pending.splice(0, pending.length);
    };

    return {
      async push(frame: Uint8Array, atMs: number) {
        if (failure) throw failure;
        void atMs;
        const sequence = nextSequence;
        nextSequence += 1;
        /*
         * **同じ frame を二度送らない。**作り直しの前後で送り直すと、
         * 同じ発言が二重に字幕へ出る。
         */
        if (!sent.has(sequence) && stream && !ended) {
          sent.add(sequence);
          /*
           * **recognizer は毎回いる。**V2 の `StreamingRecognizeRequest` は
           * 全メッセージに持たせる決まりで、音声だけを送ると
           * `Invalid resource field value` になる（V1 は最初だけでよかった）。
           */
          stream.write({ recognizer: deps.recognizer, audio: frame });
        }
        return drain();
      },
      async finish() {
        setState('draining');
        if (stream && !ended) stream.end();
        // end のあとに残りが届くので、一巡だけ待つ
        await new Promise((resolve) => setImmediate(resolve));
        setState('closed');
        return drain();
      },
    };
  }
}
