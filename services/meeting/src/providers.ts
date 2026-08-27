/**
 * STT と翻訳の差し替え口。正本 §11.2・§12.2、Phase 3 実装仕様 §1.1。
 *
 * 正本の dual path は Google に依存するが、**どの GCP プロジェクトの
 * どの認証情報を使うかは未決**（OQ-11）。research と同じ扱いにする:
 * interface を正本にし、決定的な代役を同梱し、本番では代役を拒否する。
 *
 * 代役は「賢いふり」をしない。音声の中身は読めないので、
 * **呼び出し側が渡した台本をそのまま返す**。ここで試したいのは
 * 認識精度ではなく、interim/final の扱い・話者の連続性・突き合わせだから。
 */

/** provider から返る 1 かたまり。まだ確定とは限らない。 */
export interface TranscriptResult {
  readonly isFinal: boolean;
  /**
   * 分離で付いた番号。**二次情報。**
   * 分離が無い / 使えない構成では null（`source` が一次情報になる）。
   */
  readonly speakerTag: number | null;
  readonly text: string;
  readonly startMs: number;
  readonly endMs: number;
  readonly language: string | null;
  readonly confidence: number | null;
  /**
   * どの音源から来たか。**一次情報**（正本 §11.3・§12.2）。
   *
   * `microphone` = 自分 / `system` = 相手。混ぜたものからは決まらない。
   * 分離が落ちても、この事実は残る。
   */
  readonly source?: 'microphone' | 'system' | 'mixed' | undefined;
  /** どの実装で起こしたか。モデルを変えたときの比較に要る。 */
  readonly provider?: string | undefined;
  /** 指名したモデルが使えず落ちたか。**黙って落ちない**ための印。 */
  readonly fallbackUsed?: boolean | undefined;
}

export interface StreamingConfig {
  readonly language: string;
  /**
   * この流れがどの音源か。**リアルタイムでは出所が一次情報。**
   * マイクと相手側は別の流れにして、混ぜてから起こさない。
   */
  readonly source?: 'microphone' | 'system' | 'mixed' | undefined;
  /** diarization のための話者数の見当。正本 §11.2「speaker count range」。 */
  readonly minSpeakers?: number;
  readonly maxSpeakers?: number;
}

export interface StreamingSession {
  /** 音声フレームを 1 つ渡す。結果は 0 個以上返る。 */
  push(frame: Uint8Array, atMs: number): Promise<readonly TranscriptResult[]>;
  /** 残りを吐き出して閉じる。 */
  finish(): Promise<readonly TranscriptResult[]>;
}

export interface StreamingTranscriber {
  /** V1 Streaming + diarization に相当。 */
  start(config: StreamingConfig): Promise<StreamingSession>;
  /**
   * どの実装か。**代役と本物を同じ名前で報告しないため。**
   * 名乗らないと、能力の報告に「streaming transcriber」としか出ず、
   * Google に繋がっているのか代役なのかが読めない。
   */
  readonly name: string;
  /** 本番で代役のまま起動していないかの判定に使う。 */
  readonly isStandIn: boolean;
}

export interface BatchTranscriber {
  /** V2 Chirp 3 BatchRecognize に相当。録音全体を精度優先で起こす。 */
  transcribe(audio: Uint8Array, config: StreamingConfig): Promise<readonly TranscriptResult[]>;
  readonly name: string;
  readonly isStandIn: boolean;
}

export interface TranslationProvider {
  translate(text: string, from: string, to: string): Promise<string>;
  readonly name: string;
  readonly isStandIn: boolean;
}

// ------------------------------------------------------------------ 代役

/** 代役に読ませる台本の 1 行。 */
export interface ScriptLine {
  readonly speakerTag: number;
  readonly text: string;
  readonly startMs: number;
  readonly endMs: number;
  /** final パスでだけ直る言い間違い。live と final の差を作るために使う。 */
  readonly finalText?: string;
  readonly confidence?: number;
}

/**
 * 台本を時刻どおりに吐く streaming の代役。
 *
 * 実物と同じ形で嫌がらせをする:
 *   - 確定の前に interim を出す（末尾を削った途中経過）
 *   - **話者タグを後から付け直す**ことがある。UI が跳ねないかを試せる
 */
export class ScriptedStreamingTranscriber implements StreamingTranscriber {
  readonly name = 'scripted';
  readonly isStandIn = true;
  readonly #script: readonly ScriptLine[];

  constructor(script: readonly ScriptLine[]) {
    this.#script = script;
  }

  async start(config: StreamingConfig): Promise<StreamingSession> {
    const script = this.#script;
    let emitted = 0;

    const dueBy = (atMs: number): readonly TranscriptResult[] => {
      const out: TranscriptResult[] = [];
      while (emitted < script.length && script[emitted]!.endMs <= atMs) {
        const line = script[emitted]!;
        // 実物と同じく、確定の直前に途中経過が出る
        out.push({
          isFinal: false,
          speakerTag: line.speakerTag,
          text: line.text.slice(0, Math.max(1, Math.floor(line.text.length / 2))),
          startMs: line.startMs,
          endMs: line.endMs,
          language: config.language,
          confidence: null,
        });
        out.push({
          isFinal: true,
          speakerTag: line.speakerTag,
          text: line.text,
          startMs: line.startMs,
          endMs: line.endMs,
          language: config.language,
          confidence: line.confidence ?? 0.9,
        });
        emitted += 1;
      }
      return out;
    };

    return {
      async push(_frame, atMs) {
        return dueBy(atMs);
      },
      async finish() {
        return dueBy(Number.MAX_SAFE_INTEGER);
      },
    };
  }
}

/**
 * 録音全体を「精度良く」起こす代役。
 *
 * live との差を作るために、`finalText` があればそれを使い、
 * **話者番号を 1 つずらす**。突き合わせが番号一致に頼っていないことを試せる。
 */
export class ScriptedBatchTranscriber implements BatchTranscriber {
  readonly name = 'scripted';
  readonly isStandIn = true;
  readonly #script: readonly ScriptLine[];
  readonly #speakerShift: number;

  constructor(script: readonly ScriptLine[], speakerShift = 1) {
    this.#script = script;
    this.#speakerShift = speakerShift;
  }

  async transcribe(
    _audio: Uint8Array,
    config: StreamingConfig,
  ): Promise<readonly TranscriptResult[]> {
    return this.#script.map((line) => ({
      isFinal: true,
      speakerTag: line.speakerTag + this.#speakerShift,
      text: line.finalText ?? line.text,
      startMs: line.startMs,
      endMs: line.endMs,
      language: config.language,
      confidence: 0.98,
    }));
  }
}

/** 訳したことが分かるだけの代役。訳文の質はここでは問わない。 */
export class EchoTranslationProvider implements TranslationProvider {
  readonly name = 'echo';
  readonly isStandIn = true;

  async translate(text: string, from: string, to: string): Promise<string> {
    return `[${from}->${to}] ${text}`;
  }
}

/** STT が落ちた状況を作るための代役。録音が続くことを試すのに使う。 */
export class FailingStreamingTranscriber implements StreamingTranscriber {
  readonly name = 'failing';
  readonly isStandIn = true;
  readonly #afterFrames: number;

  constructor(afterFrames = 0) {
    this.#afterFrames = afterFrames;
  }

  async start(): Promise<StreamingSession> {
    let seen = 0;
    const limit = this.#afterFrames;
    return {
      async push() {
        seen += 1;
        if (seen > limit) throw new Error('stt provider unavailable');
        return [];
      },
      async finish() {
        return [];
      },
    };
  }
}
