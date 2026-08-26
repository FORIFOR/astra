/**
 * 読み上げ。正本 §27・§23。
 *
 * **音を作れないものに、作ったふりをさせない。**
 */
import { describe, expect, it } from 'vitest';
import {
  SPEAK_FAILURES,
  SPEAK_RECOVERY,
  SilentTtsProvider,
  SpeakError,
  TTS_MARKS,
  TtsRecorder,
  speakProblems,
  ttsMeasurementProblems,
} from '../src/index.js';

describe('what can be refused before asking', () => {
  const base = { text: 'こんにちは', language: 'ja-JP' };

  it('refuses nothing to say', () => {
    expect(speakProblems({ ...base, text: '   ' })).toContain('読み上げる文がありません');
  });

  it('refuses a speed that cannot be spoken', () => {
    // 0 や負だと、鳴らないか壊れる
    expect(speakProblems({ ...base, speakingRate: 0 })).toContain('読み上げの速さが 0 以下です');
    expect(speakProblems({ ...base, speakingRate: -1 })).toHaveLength(1);
    expect(speakProblems({ ...base, speakingRate: 1.2 })).toEqual([]);
  });

  it('refuses more than one request can carry', () => {
    expect(speakProblems({ ...base, text: 'あ'.repeat(5_001) })).toContain(
      '一度に読み上げるには長すぎます',
    );
  });

  it('accepts an ordinary request', () => {
    expect(speakProblems(base)).toEqual([]);
  });
});

describe('every failure says what to do', () => {
  it('has a recovery line for each', () => {
    for (const failure of SPEAK_FAILURES) {
      expect(SPEAK_RECOVERY[failure].length).toBeGreaterThan(0);
    }
  });

  it('keeps the reason on the error', () => {
    const error = new SpeakError('rate_limited', 'too many');
    expect(error.reason).toBe('rate_limited');
    expect(error.name).toBe('SpeakError');
  });
});

describe('the stand-in', () => {
  it('says it is a stand-in', () => {
    expect(new SilentTtsProvider().isStandIn).toBe(true);
  });

  it('returns silence, not something that sounds like speech', async () => {
    const audio = await new SilentTtsProvider().speak({ text: 'あいうえお', language: 'ja-JP' });
    expect(audio.voice).toBe('silent');
    // 中身は無音。読んだふりをしない
    expect(audio.bytes.every((b) => b === 0)).toBe(true);
    expect(audio.bytes.length).toBeGreaterThan(0);
  });

  it('still refuses what cannot be spoken', async () => {
    await expect(new SilentTtsProvider().speak({ text: '', language: 'ja-JP' })).rejects.toThrow(
      SpeakError,
    );
  });
});

describe('measuring the speech', () => {
  it('separates "returned" from "started playing"', () => {
    // 全部届いてから鳴らすと、短い返事でも待たされる
    expect([...TTS_MARKS]).toEqual([
      'requested',
      'firstAudioByte',
      'audioComplete',
      'playbackStart',
      'playbackEnd',
    ]);
  });

  it('measures from the first mark', () => {
    let clock = 500;
    const recorder = new TtsRecorder('r1', () => clock);
    recorder.mark('requested');
    clock = 862;
    recorder.mark('firstAudioByte');
    recorder.describe('google-tts', 6);

    const snapshot = recorder.snapshot();
    expect(snapshot.marks.requested).toBe(0);
    expect(snapshot.marks.firstAudioByte).toBe(362);
    expect(snapshot.characters).toBe(6);
  });

  it('keeps the first of a repeated mark', () => {
    let clock = 0;
    const recorder = new TtsRecorder('r1', () => clock);
    recorder.mark('requested');
    clock = 100;
    recorder.mark('firstAudioByte');
    clock = 900;
    recorder.mark('firstAudioByte');
    expect(recorder.snapshot().marks.firstAudioByte).toBe(100);
  });

  it('rejects a measurement that runs backwards', () => {
    const problems = ttsMeasurementProblems({
      requestId: 'r1',
      marks: { firstAudioByte: 300, audioComplete: 100 },
      provider: 'google-tts',
      characters: 10,
    });
    expect(problems[0]).toContain('audioComplete');
  });

  it('accepts one that only moves forward', () => {
    expect(
      ttsMeasurementProblems({
        requestId: 'r1',
        marks: { requested: 0, firstAudioByte: 362, playbackStart: 400 },
        provider: 'google-tts',
        characters: 6,
      }),
    ).toEqual([]);
  });
});
