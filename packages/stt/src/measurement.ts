/**
 * 音声経路の実測。正本 §23。
 *
 * §23 は 10 件の目標を挙げているが、音の側は 1 件も測れていなかった。
 * **「動く」と「first partial 287ms」は別の主張**で、
 * 後者を言うには経路の途中に印が要る。
 *
 * ここが持つのは印の並びと、その読み方だけ。
 * 印を打つのは端末側（取り込みと認識）。
 *
 * **単調時計で測る。**壁時計だと、時刻合わせが入った瞬間に負の差が出る。
 */

/**
 * 音が入ってから文字が出るまでの印。**この順にしか進まない。**
 *
 *   micCaptureStart      取り込みを始めた
 *   firstPcmFrame        最初の音が届いた
 *   vadSpeechDetected    声だと判断した
 *   sttDecodeStarted     認識に渡した
 *   localSttFirstPartial 最初の途中経過が出た
 *   localSttFinal        確定が出た
 */
export const STT_MARKS = [
  'micCaptureStart',
  'firstPcmFrame',
  'vadSpeechDetected',
  'sttDecodeStarted',
  'localSttFirstPartial',
  'localSttFinal',
] as const;
export type SttMark = (typeof STT_MARKS)[number];

/** その印が §23 のどの目標に対応するか。対応の無い印は診断用。 */
export const MARK_TO_SLO: Readonly<Partial<Record<SttMark, string>>> = {
  micCaptureStart: 'micCaptureStart',
  localSttFirstPartial: 'localSttFirstPartial',
};

export interface SttMeasurement {
  /** 同じ取り込みを追うための id。会議 id / dictation id をそのまま使う。 */
  readonly requestId: string;
  /** 印ごとの経過ミリ秒。`micCaptureStart` を 0 とする。打たれていない印は入らない。 */
  readonly marks: Readonly<Partial<Record<SttMark, number>>>;
  /** 認識に使った実装。モデルを変えたときの比較に要る。 */
  readonly recognizer: string | null;
  /** 窓の長さ。first partial の下限を決めるので、数字と一緒に残す。 */
  readonly windowMs: number | null;
}

export interface MeasurementProblem {
  readonly mark: SttMark;
  readonly reason: string;
}

/**
 * 並びとして成立しているか。
 *
 * **後の印が先に来ていたら、その計測は使えない。**
 * 使えないものを平均に混ぜると、速く見える。
 */
export function measurementProblems(measurement: SttMeasurement): MeasurementProblem[] {
  const problems: MeasurementProblem[] = [];
  let previousMark: SttMark | null = null;
  let previousAt = Number.NEGATIVE_INFINITY;

  for (const mark of STT_MARKS) {
    const at = measurement.marks[mark];
    if (at === undefined) continue;
    if (!Number.isFinite(at)) {
      problems.push({ mark, reason: '数値ではありません' });
      continue;
    }
    if (at < 0) {
      problems.push({ mark, reason: '開始より前になっています' });
      continue;
    }
    if (at < previousAt) {
      problems.push({
        mark,
        reason: `${previousMark} より前に来ています（単調ではありません）`,
      });
    }
    previousMark = mark;
    previousAt = at;
  }
  return problems;
}

/** 2 つの印の差。どちらか欠けていれば null（0 と言わない）。 */
export function elapsedBetween(
  measurement: SttMeasurement,
  from: SttMark,
  to: SttMark,
): number | null {
  const a = measurement.marks[from];
  const b = measurement.marks[to];
  return a === undefined || b === undefined ? null : b - a;
}

/**
 * 印を打つ側。
 *
 * **同じ印を 2 回打たない。**最初の途中経過を測りたいのに、
 * 2 回目で上書きされると、遅い方の数字が残る。
 */
export class MeasurementRecorder {
  readonly #requestId: string;
  readonly #now: () => number;
  readonly #marks = new Map<SttMark, number>();
  #startedAt: number | null = null;
  #recognizer: string | null = null;
  #windowMs: number | null = null;

  /**
   * @param now 単調時計。既定は `performance.now()`。
   *   壁時計を渡さないこと（時刻合わせで負の差が出る）。
   */
  constructor(requestId: string, now: () => number = () => performance.now()) {
    this.#requestId = requestId;
    this.#now = now;
  }

  /** 認識の実装名と窓。数字だけ残しても、あとから比べられない。 */
  describe(recognizer: string, windowMs: number | null): void {
    this.#recognizer = recognizer;
    this.#windowMs = windowMs;
  }

  /** 印を打つ。既に打ってあれば**何もしない**。 */
  mark(mark: SttMark): void {
    if (this.#marks.has(mark)) return;
    const at = this.#now();
    if (this.#startedAt === null) this.#startedAt = at;
    this.#marks.set(mark, at - this.#startedAt);
  }

  has(mark: SttMark): boolean {
    return this.#marks.has(mark);
  }

  snapshot(): SttMeasurement {
    return {
      requestId: this.#requestId,
      marks: Object.fromEntries(this.#marks) as Partial<Record<SttMark, number>>,
      recognizer: this.#recognizer,
      windowMs: this.#windowMs,
    };
  }
}

/**
 * 窓から決まる first partial の下限。
 *
 * offline（非ストリーミング）の認識では、**窓が埋まるまで 1 文字も出ない。**
 * 目標を満たせるかどうかは、まずここで決まる。
 * 満たせない構成を「まだ測っていないだけ」と言わないための計算。
 */
export function firstPartialFloorMs(windowMs: number | null): number | null {
  return windowMs === null ? null : windowMs;
}

/** その構成で目標に届き得るか。**測る前に分かることは、測る前に言う。** */
export function canMeetFirstPartial(windowMs: number | null, budgetMs: number): boolean {
  const floor = firstPartialFloorMs(windowMs);
  return floor === null ? true : floor <= budgetMs;
}
