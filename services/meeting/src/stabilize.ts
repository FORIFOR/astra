/**
 * Segment Stabilizer と live/final の突き合わせ。Phase 3 実装仕様 §3.1・§5.1。
 *
 * ここはモデル無しで成立する部分。**provider を差し替えても壊れてはいけない**
 * 性質だけを扱うので、決定的な関数として書き、単体で試せるようにする。
 */
import { MAX_SEGMENT_MS } from '@astra/contracts';
import type { TranscriptResult } from './providers.js';

/** 確定として積む用意ができた 1 かたまり。 */
export interface StableSegment {
  readonly speakerTag: number | null;
  readonly text: string;
  readonly startMs: number;
  readonly endMs: number;
  readonly language: string | null;
  readonly confidence: number | null;
}

/**
 * 話者が同じ間は繋ぐ。細切れの segment は引用にも読解にも使えない。
 *
 * `MAX_SEGMENT_MS` で打ち切るのは逆の失敗（一人が喋り続けて 1 個の巨大な塊に
 * なり、引用が「この 10 分のどこか」になる）を避けるため。
 */
export function stabilize(results: readonly TranscriptResult[]): readonly StableSegment[] {
  const out: StableSegment[] = [];

  for (const r of results) {
    if (!r.isFinal) continue; // interim は保存しない（D-24）

    const last = out[out.length - 1];
    const joinable =
      last !== undefined &&
      last.speakerTag === r.speakerTag &&
      r.endMs - last.startMs <= MAX_SEGMENT_MS;

    if (joinable) {
      out[out.length - 1] = {
        speakerTag: last.speakerTag,
        // 連結は素直に空白で。原文の区切りを消さない。
        text: `${last.text} ${r.text}`.trim(),
        startMs: last.startMs,
        endMs: r.endMs,
        language: last.language ?? r.language,
        confidence: lowerOf(last.confidence, r.confidence),
      };
      continue;
    }
    out.push({
      speakerTag: r.speakerTag,
      text: r.text,
      startMs: r.startMs,
      endMs: r.endMs,
      language: r.language,
      confidence: r.confidence,
    });
  }
  return out;
}

/** 繋いだ塊の自信は、**低いほうに合わせる**。良く見せない。 */
function lowerOf(a: number | null, b: number | null): number | null {
  if (a === null) return b;
  if (b === null) return a;
  return Math.min(a, b);
}

// -------------------------------------------------------- reconciliation

export interface TimedSegment {
  readonly id: string;
  readonly speakerTag: number | null;
  readonly startMs: number;
  readonly endMs: number;
}

/** 2 区間の重なり（ms）。負にはしない。 */
export function overlapMs(a: TimedSegment, b: TimedSegment): number {
  return Math.max(0, Math.min(a.endMs, b.endMs) - Math.max(a.startMs, b.startMs));
}

/**
 * final の segment が、どの live segment を置き換えたのかを時刻で決める。
 *
 * **live 側は書き換えない**（D-25）。対応関係は final 側にだけ持つ。
 */
export function supersededBy(
  final: TimedSegment,
  live: readonly TimedSegment[],
): readonly string[] {
  return live.filter((l) => overlapMs(final, l) > 0).map((l) => l.id);
}

/**
 * live の話者番号と final の話者番号の対応を、重なり時間の合計で決める。
 *
 * provider が違えば番号も違う。番号一致に頼ると「田中」と名付けた人が
 * final で別人になる。**時間で対応を取る。**
 */
export function alignSpeakers(
  live: readonly TimedSegment[],
  final: readonly TimedSegment[],
): ReadonlyMap<number, number> {
  // finalTag -> liveTag -> 重なりの合計
  const weights = new Map<number, Map<number, number>>();

  for (const f of final) {
    if (f.speakerTag === null) continue;
    for (const l of live) {
      if (l.speakerTag === null) continue;
      const ms = overlapMs(f, l);
      if (ms <= 0) continue;
      const row = weights.get(f.speakerTag) ?? new Map<number, number>();
      row.set(l.speakerTag, (row.get(l.speakerTag) ?? 0) + ms);
      weights.set(f.speakerTag, row);
    }
  }

  const mapping = new Map<number, number>();
  for (const [finalTag, row] of weights) {
    let best: number | null = null;
    let bestMs = 0;
    for (const [liveTag, ms] of row) {
      // 同点なら小さい番号。決定的にしておかないと実行ごとに名前が入れ替わる。
      if (ms > bestMs || (ms === bestMs && best !== null && liveTag < best)) {
        best = liveTag;
        bestMs = ms;
      }
    }
    if (best !== null) mapping.set(finalTag, best);
  }
  return mapping;
}
