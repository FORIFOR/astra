/**
 * Task Dock の音声認識。正本 §11.1。
 *
 * モデルは差し替え口にする（sherpa-onnx / CoreML / cloud fallback）。
 * **Task Dock では speaker diarization は要らない**ので、会議側とは別の口。
 */

export interface SttConfig {
  readonly language: string;
  /** 途中経過を出すか。Dock は出す（§4.3 LISTENING は live transcript）。 */
  readonly interimResults?: boolean;
}

export interface SttResult {
  readonly text: string;
  readonly isFinal: boolean;
  /** 0〜1。低いときだけクラウドで直す判断に使う（§11.1）。 */
  readonly confidence: number | null;
}

export interface SttSession {
  push(frame: Uint8Array): Promise<readonly SttResult[]>;
  /** 話し終わり。残りを吐き出して閉じる。 */
  finish(): Promise<readonly SttResult[]>;
}

export interface StreamingSttProvider {
  readonly name: string;
  /** 手元で動くか。クラウドへ音を出すかの判断に使う。 */
  readonly isLocal: boolean;
  readonly isStandIn: boolean;
  start(config: SttConfig): Promise<SttSession>;
}

/**
 * 台本を返す代役。**音は読めないので読んだふりをしない。**
 *
 * 実物と同じ嫌がらせをする: 確定の前に途中経過を出し、
 * 指定されていれば自信を低く返す（クラウド訂正の経路を試すため）。
 */
export class ScriptedSttProvider implements StreamingSttProvider {
  readonly name = 'scripted';
  readonly isLocal = true;
  readonly isStandIn = true;
  readonly #script: readonly { text: string; confidence?: number }[];

  constructor(script: readonly { text: string; confidence?: number }[]) {
    this.#script = script;
  }

  async start(config: SttConfig): Promise<SttSession> {
    const script = this.#script;
    let at = 0;
    let frames = 0;

    return {
      async push() {
        frames += 1;
        // 3 フレームごとに 1 語進む。実物と同じく、途中経過が先に出る。
        if (frames % 3 !== 0 || at >= script.length) return [];
        const line = script[at]!;
        at += 1;
        const partial: SttResult = {
          text: line.text.slice(0, Math.max(1, Math.floor(line.text.length / 2))),
          isFinal: false,
          confidence: null,
        };
        return config.interimResults === false ? [] : [partial];
      },
      async finish() {
        // 残りを確定として吐く
        return script.slice(0, Math.max(at, 1)).map((line) => ({
          text: line.text,
          isFinal: true,
          confidence: line.confidence ?? 0.9,
        }));
      },
    };
  }
}

/** クラウドで直す側の代役。手元では動かない。 */
export class ScriptedCloudCorrector implements StreamingSttProvider {
  readonly name = 'scripted-cloud';
  readonly isLocal = false;
  readonly isStandIn = true;
  readonly #correction: string;

  constructor(correction: string) {
    this.#correction = correction;
  }

  async start(): Promise<SttSession> {
    const correction = this.#correction;
    return {
      async push() {
        return [];
      },
      async finish() {
        return [{ text: correction, isFinal: true, confidence: 0.99 }];
      },
    };
  }
}
