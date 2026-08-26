import { describe, expect, it } from 'vitest';
import { MAX_SEGMENT_MS } from '@astra/contracts';
import { alignSpeakers, overlapMs, stabilize, supersededBy } from '../src/stabilize.js';
import type { TranscriptResult } from '../src/providers.js';

const r = (over: Partial<TranscriptResult>): TranscriptResult => ({
  isFinal: true,
  speakerTag: 1,
  text: 'あ',
  startMs: 0,
  endMs: 1_000,
  language: 'ja-JP',
  confidence: 0.9,
  ...over,
});

describe('stabilize', () => {
  it('drops interim results entirely', () => {
    // interim は保存しない（D-24）
    const out = stabilize([r({ isFinal: false, text: '途中' }), r({ text: '確定' })]);
    expect(out).toHaveLength(1);
    expect(out[0]!.text).toBe('確定');
  });

  it('joins consecutive turns by the same speaker', () => {
    // 細切れの segment は引用にも読解にも使えない
    const out = stabilize([
      r({ text: '売上の話ですが', startMs: 0, endMs: 1_000 }),
      r({ text: '来月から変えます', startMs: 1_000, endMs: 2_000 }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]!.text).toBe('売上の話ですが 来月から変えます');
    expect(out[0]!.endMs).toBe(2_000);
  });

  it('starts a new segment when the speaker changes', () => {
    const out = stabilize([
      r({ speakerTag: 1, text: 'いかがですか', startMs: 0, endMs: 1_000 }),
      r({ speakerTag: 2, text: '検討します', startMs: 1_000, endMs: 2_000 }),
    ]);
    expect(out.map((s) => s.speakerTag)).toEqual([1, 2]);
  });

  it('cuts a monologue instead of growing one giant block', () => {
    // 引用が「この 10 分のどこか」になってしまうのを避ける
    const out = stabilize([
      r({ text: 'a', startMs: 0, endMs: 1_000 }),
      r({ text: 'b', startMs: MAX_SEGMENT_MS, endMs: MAX_SEGMENT_MS + 1_000 }),
    ]);
    expect(out).toHaveLength(2);
  });

  it('takes the lower confidence when it joins', () => {
    // 繋いだ結果を実際より良く見せない
    const out = stabilize([
      r({ text: 'a', confidence: 0.95, startMs: 0, endMs: 500 }),
      r({ text: 'b', confidence: 0.4, startMs: 500, endMs: 1_000 }),
    ]);
    expect(out[0]!.confidence).toBe(0.4);
  });

  it('treats an unknown speaker as its own run', () => {
    const out = stabilize([
      r({ speakerTag: null, text: 'a', startMs: 0, endMs: 500 }),
      r({ speakerTag: null, text: 'b', startMs: 500, endMs: 1_000 }),
    ]);
    // 話者不明どうしは繋ぐ（同じ扱い）が、番号付きとは混ぜない
    expect(out).toHaveLength(1);
    expect(out[0]!.speakerTag).toBeNull();
  });
});

describe('reconciliation', () => {
  const seg = (id: string, speakerTag: number | null, startMs: number, endMs: number) => ({
    id,
    speakerTag,
    startMs,
    endMs,
  });

  it('measures overlap without going negative', () => {
    expect(overlapMs(seg('a', 1, 0, 100), seg('b', 1, 200, 300))).toBe(0);
    expect(overlapMs(seg('a', 1, 0, 200), seg('b', 1, 100, 300))).toBe(100);
  });

  it('records which live segments a final one covers', () => {
    const live = [seg('l1', 1, 0, 1_000), seg('l2', 1, 1_000, 2_000), seg('l3', 2, 5_000, 6_000)];
    expect(supersededBy(seg('f1', 1, 0, 2_000), live)).toEqual(['l1', 'l2']);
  });

  it('maps speakers by time, not by number', () => {
    // provider が違えば番号も違う。番号一致に頼ると名付けた人が別人になる。
    const live = [seg('l1', 1, 0, 1_000), seg('l2', 2, 1_000, 2_000)];
    const final = [seg('f1', 5, 0, 1_000), seg('f2', 6, 1_000, 2_000)];
    const map = alignSpeakers(live, final);
    expect(map.get(5)).toBe(1);
    expect(map.get(6)).toBe(2);
  });

  it('picks the speaker it overlapped with most', () => {
    const live = [seg('l1', 1, 0, 900), seg('l2', 2, 900, 1_000)];
    const final = [seg('f1', 7, 0, 1_000)];
    expect(alignSpeakers(live, final).get(7)).toBe(1);
  });

  it('leaves a final speaker unmapped when nothing lines up', () => {
    // 対応が取れないものを無理に埋めない
    const map = alignSpeakers([seg('l1', 1, 0, 100)], [seg('f1', 9, 5_000, 6_000)]);
    expect(map.has(9)).toBe(false);
  });
});
