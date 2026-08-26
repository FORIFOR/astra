/**
 * Task Dock の音声入力を束ねる。正本 §11.1 の流れをそのまま写す。
 *
 *   Mic → Local VAD → Local streaming ASR → partial text
 *       → endpointing → optional confidence-based cloud correction
 *       → Conversation Engine
 *
 * ここで守るのは 2 つ:
 *   - **音を勝手にクラウドへ出さない。**自信が低いときに、
 *     しかも許されているときだけ出す
 *   - **無音で毎回切らない。**言い淀みで送られると会話にならない
 */
import { Vad, type VadOptions } from './vad.js';
import type { StreamingSttProvider, SttResult } from './provider.js';

export interface DictationOptions {
  readonly language?: string;
  readonly vad?: VadOptions;
  /**
   * これを下回ったらクラウドで直すことを検討する。
   * **検討するだけ**で、許可が無ければ出さない。
   */
  readonly correctionThreshold?: number;
  /**
   * クラウドへ音を出してよいか。**既定は false。**
   * 「精度が上がるなら」で既定を真にすると、
   * 手元で完結すると思っている利用者の音が外へ出る。
   */
  readonly cloudCorrectionAllowed?: boolean;
}

export interface DictationEvents {
  /** 途中経過。淡色で出す（§4.3）。 */
  onPartial?(text: string): void;
  /** 確定。ここで初めて Conversation Engine へ渡す。 */
  onFinal?(text: string, info: { corrected: boolean; confidence: number | null }): void;
  /** 言い終わったと判断した。 */
  onEndpoint?(): void;
}

export const DEFAULT_CORRECTION_THRESHOLD = 0.6;

export class Dictation {
  readonly #local: StreamingSttProvider;
  readonly #cloud: StreamingSttProvider | undefined;
  readonly #options: DictationOptions;
  readonly #events: DictationEvents;
  readonly #vad: Vad;
  #session: Awaited<ReturnType<StreamingSttProvider['start']>> | null = null;
  /** クラウドで直すために取っておく音。**出さないなら捨てる。** */
  #buffered: Uint8Array[] = [];

  constructor(
    local: StreamingSttProvider,
    events: DictationEvents = {},
    options: DictationOptions = {},
    cloud?: StreamingSttProvider,
  ) {
    this.#local = local;
    this.#cloud = cloud;
    this.#events = events;
    this.#options = options;
    this.#vad = new Vad(options.vad);
  }

  async start(): Promise<void> {
    this.#session = await this.#local.start({
      language: this.#options.language ?? 'ja-JP',
      interimResults: true,
    });
    this.#buffered = [];
    this.#vad.reset();
  }

  /** 1 フレーム。戻り値は「言い終わったか」。 */
  async push(frame: Uint8Array): Promise<boolean> {
    if (!this.#session) throw new Error('dictation has not been started');

    const vad = this.#vad.push(frame);
    // クラウドで直す可能性がある間だけ溜める。許可が無いなら溜めない。
    if (this.#mayUseCloud()) this.#buffered.push(frame);

    for (const result of await this.#session.push(frame)) {
      if (!result.isFinal) this.#events.onPartial?.(result.text);
    }

    if (vad.endpoint) {
      this.#events.onEndpoint?.();
      await this.#settle();
      return true;
    }
    return false;
  }

  /** 手動で止める。押しっぱなしを離したときなど。 */
  async stop(): Promise<void> {
    if (!this.#session) return;
    await this.#settle();
  }

  #mayUseCloud(): boolean {
    return this.#options.cloudCorrectionAllowed === true && this.#cloud !== undefined;
  }

  async #settle(): Promise<void> {
    const session = this.#session;
    if (!session) return;
    this.#session = null;

    const results = await session.finish();
    const finals = results.filter((r) => r.isFinal);
    if (finals.length === 0) {
      this.#buffered = [];
      return;
    }

    const text = finals.map((r) => r.text).join('');
    const confidence = lowestConfidence(finals);
    const threshold = this.#options.correctionThreshold ?? DEFAULT_CORRECTION_THRESHOLD;

    /*
     * 自信が低いときだけクラウドで直す。
     * **許可が無ければ、自信が低くても出さない。**
     * 手元で完結すると思っている利用者の音を、精度のために外へ出さない。
     */
    if (confidence !== null && confidence < threshold && this.#mayUseCloud()) {
      const corrected = await this.#correct();
      if (corrected !== null) {
        this.#events.onFinal?.(corrected, { corrected: true, confidence });
        this.#buffered = [];
        return;
      }
    }

    this.#events.onFinal?.(text, { corrected: false, confidence });
    this.#buffered = [];
  }

  async #correct(): Promise<string | null> {
    if (!this.#cloud) return null;
    try {
      const session = await this.#cloud.start({ language: this.#options.language ?? 'ja-JP' });
      for (const frame of this.#buffered) await session.push(frame);
      const results = await session.finish();
      const text = results
        .filter((r) => r.isFinal)
        .map((r) => r.text)
        .join('');
      return text.length > 0 ? text : null;
    } catch {
      // 直せなかったら手元の結果を使う。**黙って失敗にしない。**
      return null;
    }
  }
}

/** 束の自信は**低いほうに合わせる**。良く見せない。 */
export function lowestConfidence(results: readonly SttResult[]): number | null {
  const values = results.map((r) => r.confidence).filter((c): c is number => typeof c === 'number');
  return values.length === 0 ? null : Math.min(...values);
}
