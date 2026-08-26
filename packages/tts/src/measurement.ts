/**
 * 読み上げの実測。正本 §23 の考え方を音へ。
 *
 * **「返ってきた」と「鳴り始めた」は別の主張。**
 * 全部届いてから鳴らすと、短い返事でも待たされる。
 */

export const TTS_MARKS = [
  'requested',
  'firstAudioByte',
  'audioComplete',
  'playbackStart',
  'playbackEnd',
] as const;
export type TtsMark = (typeof TTS_MARKS)[number];

export interface TtsMeasurement {
  readonly requestId: string;
  readonly marks: Readonly<Partial<Record<TtsMark, number>>>;
  readonly provider: string | null;
  /** 読み上げた文字数。長さと時間を一緒に見ないと比べられない。 */
  readonly characters: number | null;
}

/** 並びとして成立しているか。**後の印が先に来ていたら使えない。** */
export function ttsMeasurementProblems(measurement: TtsMeasurement): string[] {
  const problems: string[] = [];
  let previous = Number.NEGATIVE_INFINITY;
  let previousMark: TtsMark | null = null;

  for (const mark of TTS_MARKS) {
    const at = measurement.marks[mark];
    if (at === undefined) continue;
    if (!Number.isFinite(at) || at < 0) {
      problems.push(`${mark} が数値として使えません`);
      continue;
    }
    if (at < previous) problems.push(`${mark} が ${previousMark} より前に来ています`);
    previous = at;
    previousMark = mark;
  }
  return problems;
}

export class TtsRecorder {
  readonly #requestId: string;
  readonly #now: () => number;
  readonly #marks = new Map<TtsMark, number>();
  #startedAt: number | null = null;
  #provider: string | null = null;
  #characters: number | null = null;

  constructor(requestId: string, now: () => number = () => performance.now()) {
    this.#requestId = requestId;
    this.#now = now;
  }

  describe(provider: string, characters: number): void {
    this.#provider = provider;
    this.#characters = characters;
  }

  /** 印を打つ。**同じ印を 2 回打たない。** */
  mark(mark: TtsMark): void {
    if (this.#marks.has(mark)) return;
    const at = this.#now();
    this.#startedAt ??= at;
    this.#marks.set(mark, at - this.#startedAt);
  }

  snapshot(): TtsMeasurement {
    return {
      requestId: this.#requestId,
      marks: Object.fromEntries(this.#marks) as Partial<Record<TtsMark, number>>,
      provider: this.#provider,
      characters: this.#characters,
    };
  }
}
