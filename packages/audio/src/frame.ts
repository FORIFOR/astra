/**
 * PCM フレーム。正本 §11・§12。
 *
 * **出所を落とさない。**
 *
 * DeepNote はマイクのコールバックの中でシステム音声を混ぜ、
 * 混ざった `Vec<f32>` だけを認識と録音へ渡していた。
 * あとから「この発言はどちらから来たか」を言えない。
 *
 * Astra は会議の話者対応（§12）と、外へ出す判断（§22）で出所が要る。
 * 混ぜたものは `mixed` として**別の frame** にし、元を捨てない。
 */

/** どこから来た音か。 */
export const AUDIO_SOURCES = ['microphone', 'system', 'mixed'] as const;
export type AudioSourceKind = (typeof AUDIO_SOURCES)[number];

/** 手元で扱う標準の形。会議側（§12）と Dock 側（§11.1）で揃える。 */
export const SAMPLE_RATE_HZ = 16_000;
export const CHANNELS = 1;

export interface PcmFrame {
  readonly source: AudioSourceKind;
  /** -1.0〜1.0 の mono サンプル。 */
  readonly samples: Float32Array;
  readonly sampleRate: number;
  /** 取り込み開始からの位置。**壁時計ではない**（一時停止で飛ばない）。 */
  readonly offsetMs: number;
  /** 取り込み順。欠番が出たら落ちている。 */
  readonly sequence: number;
}

export function frameDurationMs(frame: Pick<PcmFrame, 'samples' | 'sampleRate'>): number {
  return frame.sampleRate === 0 ? 0 : (frame.samples.length / frame.sampleRate) * 1000;
}

/**
 * 多チャンネルを mono に落とす。
 *
 * **平均する。**片チャンネルだけ採ると、片方にしか入っていない声が消える。
 */
export function toMono(interleaved: Float32Array, channels: number): Float32Array {
  if (channels <= 1) return interleaved;
  const frames = Math.floor(interleaved.length / channels);
  const mono = new Float32Array(frames);
  for (let i = 0; i < frames; i += 1) {
    let sum = 0;
    for (let c = 0; c < channels; c += 1) sum += interleaved[i * channels + c] ?? 0;
    mono[i] = sum / channels;
  }
  return mono;
}

/** 16bit little-endian PCM へ。録音と転送はこの形。 */
export function toPcm16(samples: Float32Array): Uint8Array {
  const out = new Uint8Array(samples.length * 2);
  const view = new DataView(out.buffer);
  for (let i = 0; i < samples.length; i += 1) {
    // クランプしてから丸める。溢れたまま丸めると符号が反転する。
    const clamped = Math.max(-1, Math.min(1, samples[i] ?? 0));
    /*
     * 復号側と同じ 32768 で測る。**片方だけ 32767 にしない。**
     * 目盛りがずれると、往復のたびに誤差が 1 段ぶん増える。
     * int16 の上限は 32767 なので、そこだけ抑える。
     */
    view.setInt16(i * 2, Math.min(32_767, Math.round(clamped * 32_768)), true);
  }
  return out;
}

export function fromPcm16(bytes: Uint8Array): Float32Array {
  const count = Math.floor(bytes.byteLength / 2);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const samples = new Float32Array(count);
  for (let i = 0; i < count; i += 1) samples[i] = view.getInt16(i * 2, true) / 32_768;
  return samples;
}

/** 音の大きさ。0〜1。level meter と VAD の入力。 */
export function rms(samples: Float32Array): number {
  if (samples.length === 0) return 0;
  let sum = 0;
  for (const sample of samples) sum += sample * sample;
  return Math.sqrt(sum / samples.length);
}
