/** Google TTS の LINEAR16 を Web Audio で再生し、Orb 用の実音量を測る。 */
import type { VoiceSynthesisResponse } from '@astra/contracts';

interface Pcm16 {
  readonly samples: Float32Array<ArrayBuffer>;
  readonly sampleRate: number;
}

function bytesFromBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function ascii(view: DataView, offset: number, length: number): string {
  let value = '';
  for (let index = 0; index < length; index += 1) {
    value += String.fromCharCode(view.getUint8(offset + index));
  }
  return value;
}

/** Google LINEAR16 は通常 WAV。raw PCM16 が返っても同じ経路で扱う。 */
export function decodePcm16(payload: VoiceSynthesisResponse): Pcm16 {
  const bytes = bytesFromBase64(payload.audio_base64);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let sampleRate: number = payload.sample_rate_hz;
  let pcmOffset = 0;
  let pcmLength = bytes.byteLength;

  if (
    bytes.byteLength >= 12 &&
    ascii(view, 0, 4) === 'RIFF' &&
    ascii(view, 8, 4) === 'WAVE'
  ) {
    let cursor = 12;
    let format = 1;
    let channels = 1;
    let bits = 16;
    let foundData = false;
    while (cursor + 8 <= bytes.byteLength) {
      const id = ascii(view, cursor, 4);
      const length = view.getUint32(cursor + 4, true);
      const body = cursor + 8;
      if (body + length > bytes.byteLength) break;
      if (id === 'fmt ' && length >= 16) {
        format = view.getUint16(body, true);
        channels = view.getUint16(body + 2, true);
        sampleRate = view.getUint32(body + 4, true);
        bits = view.getUint16(body + 14, true);
      } else if (id === 'data') {
        pcmOffset = body;
        pcmLength = length;
        foundData = true;
        break;
      }
      cursor = body + length + (length % 2);
    }
    if (!foundData || format !== 1 || channels !== 1 || bits !== 16) {
      throw new Error('読み上げ音声の形式を再生できません');
    }
  }

  const sampleCount = Math.floor(pcmLength / 2);
  const samples = new Float32Array(sampleCount);
  for (let index = 0; index < sampleCount; index += 1) {
    samples[index] = view.getInt16(pcmOffset + index * 2, true) / 32_768;
  }
  return { samples, sampleRate };
}

export async function playVoiceAudio(
  payload: VoiceSynthesisResponse,
  onLevel: (level: number) => void,
  signal: AbortSignal,
): Promise<void> {
  if (signal.aborted) throw new DOMException('読み上げを止めました', 'AbortError');
  const pcm = decodePcm16(payload);
  const context = new AudioContext({ sampleRate: pcm.sampleRate });
  const buffer = context.createBuffer(1, pcm.samples.length, pcm.sampleRate);
  buffer.copyToChannel(pcm.samples, 0);

  const source = context.createBufferSource();
  const analyser = context.createAnalyser();
  analyser.fftSize = 512;
  source.buffer = buffer;
  source.connect(analyser);
  analyser.connect(context.destination);

  const frame = new Float32Array(analyser.fftSize);
  let animation = 0;
  const measure = (): void => {
    analyser.getFloatTimeDomainData(frame);
    let energy = 0;
    for (const sample of frame) energy += sample * sample;
    onLevel(Math.min(1, Math.sqrt(energy / frame.length) * 3));
    animation = requestAnimationFrame(measure);
  };

  try {
    await new Promise<void>((resolve, reject) => {
      const stop = (): void => {
        try {
          source.stop();
        } catch {
          // 既に終わっていれば止めるものはない。
        }
        reject(new DOMException('読み上げを止めました', 'AbortError'));
      };
      signal.addEventListener('abort', stop, { once: true });
      source.addEventListener(
        'ended',
        () => {
          signal.removeEventListener('abort', stop);
          resolve();
        },
        { once: true },
      );
      animation = requestAnimationFrame(measure);
      source.start();
    });
  } finally {
    cancelAnimationFrame(animation);
    onLevel(0);
    source.disconnect();
    analyser.disconnect();
    await context.close();
  }
}
