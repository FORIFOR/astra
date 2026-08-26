/**
 * 混ぜる。正本 §12。
 *
 * **混ぜた結果で元を置き換えない。**
 * 会議の話者対応も、外へ出してよいかの判断も、
 * 「どちらから来たか」が要る。混ぜたものは別の frame として足す。
 */
import { frameDurationMs, type PcmFrame } from './frame.js';

export interface MixOptions {
  readonly microphoneGain?: number;
  readonly systemGain?: number;
}

/**
 * 2 本を足してクランプする。
 *
 * 長さが違うときは短い方を無音で埋める。
 * **切り詰めない。**切ると、片方だけ入っていた声が消える。
 */
export function mixSamples(
  microphone: Float32Array,
  system: Float32Array,
  options: MixOptions = {},
): Float32Array {
  const micGain = options.microphoneGain ?? 1;
  const sysGain = options.systemGain ?? 1;
  const length = Math.max(microphone.length, system.length);
  const out = new Float32Array(length);
  for (let i = 0; i < length; i += 1) {
    const m = (microphone[i] ?? 0) * micGain;
    const s = (system[i] ?? 0) * sysGain;
    out[i] = Math.max(-1, Math.min(1, m + s));
  }
  return out;
}

/**
 * 混合フレームを**足す**。元の 2 本はそのまま返り値に含まれる。
 *
 * 呼ぶ側が「認識には mixed を、記録には全部を」と選べるようにするため。
 */
export function withMixedFrame(
  microphone: PcmFrame,
  system: PcmFrame,
  sequence: number,
  options: MixOptions = {},
): readonly PcmFrame[] {
  if (microphone.sampleRate !== system.sampleRate) {
    // 混ぜる前に揃っている前提。揃っていないものを黙って混ぜない。
    throw new Error(
      `cannot mix ${microphone.sampleRate}Hz with ${system.sampleRate}Hz; resample first`,
    );
  }
  const mixed: PcmFrame = {
    source: 'mixed',
    samples: mixSamples(microphone.samples, system.samples, options),
    sampleRate: microphone.sampleRate,
    // 位置は早い方に合わせる。遅い方に合わせると、頭が欠ける。
    offsetMs: Math.min(microphone.offsetMs, system.offsetMs),
    sequence,
  };
  return [microphone, system, mixed];
}

/** 認識へ渡す 1 本を選ぶ。**mixed があればそれ、無ければマイク。** */
export function frameForRecognition(frames: readonly PcmFrame[]): PcmFrame | null {
  return (
    frames.find((frame) => frame.source === 'mixed') ??
    frames.find((frame) => frame.source === 'microphone') ??
    frames[0] ??
    null
  );
}

/** 記録に残す全部の長さ。診断用。 */
export function totalDurationMs(frames: readonly PcmFrame[]): number {
  return frames.reduce((sum, frame) => sum + frameDurationMs(frame), 0);
}
