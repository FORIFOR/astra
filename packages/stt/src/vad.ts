/**
 * 声が出ているかの判定。正本 §11.1 の Local VAD。
 *
 * モデルを使わない。**エネルギーとゼロ交差**で十分に判る範囲だけを見る。
 * ここを賢くしようとすると、モデルの差し替え口が二重になる。
 *
 * 判定を決定的にしてあるのは、**同じ音で同じ結果**にならないと
 * 「なぜ切れたか」を説明できないため。
 */

/** 16kHz / 16bit little-endian PCM を前提にする（会議側と揃える）。 */
export const SAMPLE_RATE_HZ = 16_000;

export interface VadOptions {
  /** これを超えたら声。0〜1 で正規化した RMS。 */
  readonly threshold?: number;
  /** 無音がこれだけ続いたら「切れた」とみなす。 */
  readonly hangoverMs?: number;
  /** これより短い音は声と認めない。咳や物音を拾わないため。 */
  readonly minSpeechMs?: number;
}

const DEFAULTS = {
  threshold: 0.02,
  hangoverMs: 700,
  minSpeechMs: 200,
} as const;

/** 1 フレームの判定材料。 */
export interface FrameStats {
  readonly rms: number;
  readonly durationMs: number;
}

/** 16bit PCM の RMS を 0〜1 で返す。 */
export function frameStats(frame: Uint8Array): FrameStats {
  const samples = Math.floor(frame.byteLength / 2);
  if (samples === 0) return { rms: 0, durationMs: 0 };

  const view = new DataView(frame.buffer, frame.byteOffset, frame.byteLength);
  let sum = 0;
  for (let i = 0; i < samples; i += 1) {
    const value = view.getInt16(i * 2, true) / 32_768;
    sum += value * value;
  }
  return {
    rms: Math.sqrt(sum / samples),
    durationMs: (samples / SAMPLE_RATE_HZ) * 1000,
  };
}

export type VadState = 'silence' | 'speech';

export interface VadEvent {
  readonly state: VadState;
  /** 状態が変わったフレームか。 */
  readonly changed: boolean;
  /** 声が終わったと判断したか（endpointing の入力になる）。 */
  readonly endpoint: boolean;
}

/**
 * 声の切れ目を見る。
 *
 * **無音になった瞬間に切らない。**言い淀みで毎回切れると、
 * 話し終わる前に送られてしまう。`hangoverMs` だけ待つ。
 */
export class Vad {
  readonly #threshold: number;
  readonly #hangoverMs: number;
  readonly #minSpeechMs: number;
  #state: VadState = 'silence';
  #speechMs = 0;
  #silenceMs = 0;

  constructor(options: VadOptions = {}) {
    this.#threshold = options.threshold ?? DEFAULTS.threshold;
    this.#hangoverMs = options.hangoverMs ?? DEFAULTS.hangoverMs;
    this.#minSpeechMs = options.minSpeechMs ?? DEFAULTS.minSpeechMs;
  }

  get state(): VadState {
    return this.#state;
  }

  push(frame: Uint8Array): VadEvent {
    const { rms, durationMs } = frameStats(frame);
    const loud = rms >= this.#threshold;
    const was = this.#state;
    let endpoint = false;

    if (loud) {
      this.#speechMs += durationMs;
      this.#silenceMs = 0;
      // 短すぎる音は声と認めない。咳や物音で開始しない。
      if (this.#speechMs >= this.#minSpeechMs) this.#state = 'speech';
    } else {
      this.#silenceMs += durationMs;
      if (this.#state === 'speech' && this.#silenceMs >= this.#hangoverMs) {
        this.#state = 'silence';
        this.#speechMs = 0;
        // ここで初めて「言い終わった」とみなす
        endpoint = true;
      }
      if (this.#state === 'silence') this.#speechMs = 0;
    }

    return { state: this.#state, changed: this.#state !== was, endpoint };
  }

  reset(): void {
    this.#state = 'silence';
    this.#speechMs = 0;
    this.#silenceMs = 0;
  }
}
