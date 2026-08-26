/**
 * PCM フレーム。正本 §11・§12。
 *
 * **出所を落とさない**ことが、この package の存在理由。
 */
import { describe, expect, it } from 'vitest';
import {
  AUDIO_SOURCES,
  captureProblems,
  CAPTURE_RECOVERY,
  CAPTURE_FAILURES,
  frameDurationMs,
  frameForRecognition,
  fromPcm16,
  mixSamples,
  rms,
  SAMPLE_RATE_HZ,
  toMono,
  toPcm16,
  totalDurationMs,
  withMixedFrame,
  type PcmFrame,
} from '../src/index.js';

const frame = (over: Partial<PcmFrame> & Pick<PcmFrame, 'source'>): PcmFrame => ({
  samples: new Float32Array([0.1, 0.2, 0.3, 0.4]),
  sampleRate: SAMPLE_RATE_HZ,
  offsetMs: 0,
  sequence: 1,
  ...over,
});

describe('mono downmix', () => {
  it('averages the channels rather than taking one', () => {
    // 片チャンネルだけ採ると、片方にしか入っていない声が消える
    const stereo = new Float32Array([1, 0, 0, 1]);
    expect([...toMono(stereo, 2)]).toEqual([0.5, 0.5]);
  });

  it('leaves mono alone', () => {
    const mono = new Float32Array([0.5]);
    expect(toMono(mono, 1)).toBe(mono);
  });
});

describe('16 bit conversion', () => {
  it('round-trips within a sample step', () => {
    const original = new Float32Array([0, 0.5, -0.5, 0.999]);
    const back = fromPcm16(toPcm16(original));
    for (let i = 0; i < original.length; i += 1) {
      expect(Math.abs((back[i] ?? 0) - (original[i] ?? 0))).toBeLessThan(1 / 32_768 + 1e-6);
    }
  });

  it('clamps before rounding, so a loud sample does not flip sign', () => {
    // 溢れたまま丸めると符号が反転する
    const back = fromPcm16(toPcm16(new Float32Array([2, -2])));
    expect(back[0]).toBeGreaterThan(0.99);
    expect(back[1]).toBeLessThan(-0.99);
  });
});

describe('mixing', () => {
  it('pads the shorter side instead of truncating', () => {
    // 切ると、片方だけ入っていた声が消える
    const mixed = mixSamples(new Float32Array([0.5]), new Float32Array([0.5, 0.5]));
    expect(mixed).toHaveLength(2);
    expect(mixed[1]).toBeCloseTo(0.5);
  });

  it('clamps the sum', () => {
    const mixed = mixSamples(new Float32Array([0.8]), new Float32Array([0.8]));
    expect(mixed[0]).toBe(1);
  });

  it('keeps the originals alongside the mix', () => {
    const frames = withMixedFrame(frame({ source: 'microphone' }), frame({ source: 'system' }), 9);
    // 混ぜた結果で元を置き換えない
    expect(frames.map((f) => f.source)).toEqual(['microphone', 'system', 'mixed']);
    expect(frames.every((f) => f.samples.length > 0)).toBe(true);
  });

  it('takes the earlier offset, so the head is not cut', () => {
    const frames = withMixedFrame(
      frame({ source: 'microphone', offsetMs: 100 }),
      frame({ source: 'system', offsetMs: 140 }),
      1,
    );
    expect(frames[2]!.offsetMs).toBe(100);
  });

  it('refuses to mix two different sample rates', () => {
    expect(() =>
      withMixedFrame(
        frame({ source: 'microphone' }),
        frame({ source: 'system', sampleRate: 48_000 }),
        1,
      ),
    ).toThrow(/resample first/);
  });
});

describe('choosing what to recognise', () => {
  it('prefers the mix, then the microphone', () => {
    const mic = frame({ source: 'microphone' });
    const sys = frame({ source: 'system' });
    const mixed = frame({ source: 'mixed' });
    expect(frameForRecognition([mic, sys, mixed])!.source).toBe('mixed');
    expect(frameForRecognition([sys, mic])!.source).toBe('microphone');
    expect(frameForRecognition([])).toBeNull();
  });
});

describe('duration and level', () => {
  it('measures a frame from its sample count', () => {
    const one = frame({ source: 'microphone', samples: new Float32Array(SAMPLE_RATE_HZ) });
    expect(frameDurationMs(one)).toBe(1000);
    expect(totalDurationMs([one, one])).toBe(2000);
  });

  it('reports silence as zero, not as a tiny number', () => {
    expect(rms(new Float32Array(100))).toBe(0);
    expect(rms(new Float32Array())).toBe(0);
  });
});

describe('what a capture configuration must say', () => {
  it('refuses a recording of nothing', () => {
    expect(captureProblems({ sources: [] })).toContain('録音する音声が選ばれていません');
  });

  it('refuses to mix what it is not capturing', () => {
    expect(captureProblems({ sources: ['microphone'], mix: true })).toContain(
      '混合するにはシステム音声が要ります',
    );
  });

  it('accepts an ordinary one', () => {
    expect(captureProblems({ sources: ['microphone', 'system'], mix: true })).toEqual([]);
  });

  it('tells the user what to do about every failure', () => {
    for (const failure of CAPTURE_FAILURES) {
      // §21: 影響と次の選択肢を書く
      expect(CAPTURE_RECOVERY[failure].length).toBeGreaterThan(0);
    }
  });

  it('names all three sources', () => {
    expect([...AUDIO_SOURCES]).toEqual(['microphone', 'system', 'mixed']);
  });
});
