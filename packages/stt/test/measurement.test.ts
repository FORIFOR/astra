/**
 * 音声経路の実測。正本 §23。
 *
 * **「動く」と「first partial 287ms」は別の主張。**
 */
import { describe, expect, it } from 'vitest';
import {
  MeasurementRecorder,
  STT_MARKS,
  canMeetFirstPartial,
  elapsedBetween,
  firstPartialFloorMs,
  measurementProblems,
  type SttMeasurement,
} from '../src/measurement.js';

const measurement = (marks: SttMeasurement['marks']): SttMeasurement => ({
  requestId: 'r1',
  marks,
  recognizer: 'test',
  windowMs: null,
});

describe('the marks', () => {
  it('are the path from sound to text, in order', () => {
    expect([...STT_MARKS]).toEqual([
      'micCaptureStart',
      'firstPcmFrame',
      'vadSpeechDetected',
      'sttDecodeStarted',
      'localSttFirstPartial',
      'localSttFinal',
    ]);
  });
});

describe('recording them', () => {
  it('measures from the first mark, not from an absolute clock', () => {
    let clock = 1_000;
    const recorder = new MeasurementRecorder('r1', () => clock);
    recorder.mark('micCaptureStart');
    clock = 1_018;
    recorder.mark('firstPcmFrame');

    const snapshot = recorder.snapshot();
    expect(snapshot.marks.micCaptureStart).toBe(0);
    expect(snapshot.marks.firstPcmFrame).toBe(18);
  });

  it('keeps the first of a repeated mark', () => {
    let clock = 0;
    const recorder = new MeasurementRecorder('r1', () => clock);
    recorder.mark('micCaptureStart');
    clock = 100;
    recorder.mark('localSttFirstPartial');
    clock = 900;
    // 2 回目で上書きされると、遅い方の数字が残る
    recorder.mark('localSttFirstPartial');
    expect(recorder.snapshot().marks.localSttFirstPartial).toBe(100);
  });

  it('leaves out a mark that never happened', () => {
    const recorder = new MeasurementRecorder('r1', () => 0);
    recorder.mark('micCaptureStart');
    // 打っていない印は 0 として入らない（0 は「速かった」に見える）
    expect(recorder.snapshot().marks.localSttFinal).toBeUndefined();
    expect(recorder.has('localSttFinal')).toBe(false);
  });

  it('carries the recognizer and the window, so numbers can be compared later', () => {
    const recorder = new MeasurementRecorder('r1', () => 0);
    recorder.describe('sherpa-onnx-ja', 6_000);
    const snapshot = recorder.snapshot();
    expect(snapshot.recognizer).toBe('sherpa-onnx-ja');
    expect(snapshot.windowMs).toBe(6_000);
  });
});

describe('checking a measurement before believing it', () => {
  it('accepts one that only moves forward', () => {
    expect(
      measurementProblems(
        measurement({ micCaptureStart: 0, firstPcmFrame: 18, localSttFirstPartial: 287 }),
      ),
    ).toEqual([]);
  });

  it('rejects one where a later mark came first', () => {
    // 使えないものを平均に混ぜると、速く見える
    const problems = measurementProblems(measurement({ firstPcmFrame: 100, sttDecodeStarted: 40 }));
    expect(problems[0]!.mark).toBe('sttDecodeStarted');
    expect(problems[0]!.reason).toContain('単調ではありません');
  });

  it('rejects a negative offset', () => {
    expect(measurementProblems(measurement({ firstPcmFrame: -1 }))[0]!.reason).toContain(
      '開始より前',
    );
  });

  it('rejects a value that is not a number', () => {
    expect(measurementProblems(measurement({ firstPcmFrame: Number.NaN }))[0]!.reason).toContain(
      '数値ではありません',
    );
  });
});

describe('reading it', () => {
  it('gives null rather than zero when a mark is missing', () => {
    const one = measurement({ micCaptureStart: 0 });
    expect(elapsedBetween(one, 'micCaptureStart', 'localSttFirstPartial')).toBeNull();
    expect(
      elapsedBetween(
        measurement({ micCaptureStart: 0, localSttFirstPartial: 287 }),
        'micCaptureStart',
        'localSttFirstPartial',
      ),
    ).toBe(287);
  });
});

describe('what the window decides before anything is measured', () => {
  it('says the floor a non-streaming recogniser cannot go below', () => {
    // 窓が埋まるまで 1 文字も出ない
    expect(firstPartialFloorMs(6_000)).toBe(6_000);
    expect(firstPartialFloorMs(null)).toBeNull();
  });

  it('knows a 6 second window cannot meet a 350ms budget', () => {
    // 測る前に分かることは、測る前に言う
    expect(canMeetFirstPartial(6_000, 350)).toBe(false);
    expect(canMeetFirstPartial(300, 350)).toBe(true);
    // 窓の分からない実装は、測ってみるまで判断しない
    expect(canMeetFirstPartial(null, 350)).toBe(true);
  });
});
