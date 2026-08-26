/**
 * Task Dock の音声入力。正本 §11.1。
 *
 * 確かめたいのは「認識できること」ではなく、
 * **音を勝手にクラウドへ出さないこと**と**言い淀みで切らないこと**。
 */
import { describe, expect, it, vi } from 'vitest';
import {
  Dictation,
  ScriptedCloudCorrector,
  ScriptedSttProvider,
  Vad,
  frameStats,
  lowestConfidence,
} from '../src/index.js';

/** 100ms 分の 16kHz/16bit。振幅で声のあるなしを作る。 */
function frame(amplitude: number): Uint8Array {
  const samples = 1_600;
  const buffer = new ArrayBuffer(samples * 2);
  const view = new DataView(buffer);
  for (let i = 0; i < samples; i += 1) {
    // 一定の振幅。ゼロ交差させて直流にしない。
    view.setInt16(i * 2, (i % 2 === 0 ? 1 : -1) * Math.round(amplitude * 32_767), true);
  }
  return new Uint8Array(buffer);
}

const LOUD = frame(0.3);
const QUIET = frame(0.001);

describe('frameStats', () => {
  it('measures a loud frame above a quiet one', () => {
    expect(frameStats(LOUD).rms).toBeGreaterThan(frameStats(QUIET).rms);
    expect(frameStats(LOUD).durationMs).toBe(100);
  });

  it('says nothing about an empty frame instead of dividing by zero', () => {
    expect(frameStats(new Uint8Array(0))).toEqual({ rms: 0, durationMs: 0 });
  });
});

describe('Vad', () => {
  it('does not start on a short noise', () => {
    // 咳や物音で開始しない
    const vad = new Vad({ minSpeechMs: 200 });
    expect(vad.push(LOUD).state).toBe('silence');
    expect(vad.push(LOUD).state).toBe('speech');
  });

  it('does not cut on a pause in the middle of a sentence', () => {
    // 言い淀みで毎回切れると、話し終わる前に送られる
    const vad = new Vad({ hangoverMs: 700 });
    vad.push(LOUD);
    vad.push(LOUD);
    expect(vad.push(QUIET).endpoint).toBe(false);
    expect(vad.push(QUIET).endpoint).toBe(false);
    expect(vad.push(LOUD).state).toBe('speech');
  });

  it('cuts once the silence has actually lasted', () => {
    const vad = new Vad({ hangoverMs: 300 });
    vad.push(LOUD);
    vad.push(LOUD);
    vad.push(QUIET);
    vad.push(QUIET);
    expect(vad.push(QUIET).endpoint).toBe(true);
    expect(vad.state).toBe('silence');
  });

  it('only reports the endpoint once', () => {
    const vad = new Vad({ hangoverMs: 200 });
    vad.push(LOUD);
    vad.push(LOUD);
    vad.push(QUIET);
    expect(vad.push(QUIET).endpoint).toBe(true);
    expect(vad.push(QUIET).endpoint).toBe(false);
  });
});

describe('Dictation', () => {
  const local = () => new ScriptedSttProvider([{ text: '競合を調べて', confidence: 0.95 }]);
  const unsure = () => new ScriptedSttProvider([{ text: 'きょごうをしらべて', confidence: 0.3 }]);

  const run = async (dictation: Dictation, frames: readonly Uint8Array[]) => {
    await dictation.start();
    for (const f of frames) await dictation.push(f);
    await dictation.stop();
  };

  it('hands the settled text over, not the partials', async () => {
    const onFinal = vi.fn();
    const onPartial = vi.fn();
    const dictation = new Dictation(local(), { onFinal, onPartial });
    await run(dictation, [LOUD, LOUD, LOUD, LOUD]);

    expect(onPartial).toHaveBeenCalled();
    expect(onFinal).toHaveBeenCalledWith(
      '競合を調べて',
      expect.objectContaining({ corrected: false }),
    );
  });

  it('reports the endpoint when the speaker stops', async () => {
    const onEndpoint = vi.fn();
    const dictation = new Dictation(local(), { onEndpoint }, { vad: { hangoverMs: 200 } });
    await dictation.start();
    await dictation.push(LOUD);
    await dictation.push(LOUD);
    await dictation.push(QUIET);
    const ended = await dictation.push(QUIET);
    expect(ended).toBe(true);
    expect(onEndpoint).toHaveBeenCalled();
  });

  it('does NOT send audio to the cloud, even when it is unsure', async () => {
    // 手元で完結すると思っている利用者の音を、精度のために外へ出さない
    const cloud = new ScriptedCloudCorrector('競合を調べて');
    const started = vi.spyOn(cloud, 'start');
    const onFinal = vi.fn();

    const dictation = new Dictation(unsure(), { onFinal }, {}, cloud);
    await run(dictation, [LOUD, LOUD, LOUD, LOUD]);

    expect(started).not.toHaveBeenCalled();
    expect(onFinal).toHaveBeenCalledWith(
      'きょごうをしらべて',
      expect.objectContaining({ corrected: false }),
    );
  });

  it('sends it only when it is unsure AND allowed', async () => {
    const cloud = new ScriptedCloudCorrector('競合を調べて');
    const onFinal = vi.fn();
    const dictation = new Dictation(unsure(), { onFinal }, { cloudCorrectionAllowed: true }, cloud);
    await run(dictation, [LOUD, LOUD, LOUD, LOUD]);

    expect(onFinal).toHaveBeenCalledWith(
      '競合を調べて',
      expect.objectContaining({ corrected: true }),
    );
  });

  it('does not send when it was confident, even if allowed', async () => {
    const cloud = new ScriptedCloudCorrector('別の文');
    const started = vi.spyOn(cloud, 'start');
    const dictation = new Dictation(local(), {}, { cloudCorrectionAllowed: true }, cloud);
    await run(dictation, [LOUD, LOUD, LOUD, LOUD]);
    expect(started).not.toHaveBeenCalled();
  });

  it('falls back to what it heard when the cloud cannot help', async () => {
    const broken = {
      name: 'broken',
      isLocal: false,
      isStandIn: true,
      async start(): Promise<never> {
        throw new Error('unreachable');
      },
    };
    const onFinal = vi.fn();
    const dictation = new Dictation(
      unsure(),
      { onFinal },
      { cloudCorrectionAllowed: true },
      broken,
    );
    await run(dictation, [LOUD, LOUD, LOUD, LOUD]);
    // 黙って失敗にしない。手元の結果を使う。
    expect(onFinal).toHaveBeenCalledWith(
      'きょごうをしらべて',
      expect.objectContaining({ corrected: false }),
    );
  });

  it('refuses to take audio before it was started', async () => {
    const dictation = new Dictation(local());
    await expect(dictation.push(LOUD)).rejects.toThrow(/not been started/);
  });
});

describe('lowestConfidence', () => {
  it('takes the worst, not the average', () => {
    // 束を実際より良く見せない
    expect(
      lowestConfidence([
        { text: 'a', isFinal: true, confidence: 0.9 },
        { text: 'b', isFinal: true, confidence: 0.2 },
      ]),
    ).toBe(0.2);
  });

  it('says nothing when nothing reported a confidence', () => {
    expect(lowestConfidence([{ text: 'a', isFinal: true, confidence: null }])).toBeNull();
  });
});
