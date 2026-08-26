/**
 * Video Agent。正本 §15.2。
 *
 * モデルが無くても、**段取りの側は全部確かめられる。**
 */
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CLIP_MS,
  layout,
  orderBetween,
  renderProblems,
  storyboard,
  timeline,
  toWebVtt,
  totalDurationMs,
  voiceoverScript,
  type Clip,
} from '../src/video.js';

const clip = (over: Partial<Clip> & Pick<Clip, 'id' | 'order'>): Clip => ({
  name: `clip ${over.order}`,
  prompt: '雨の街',
  sourceArtifactId: null,
  durationMs: 2_000,
  subtitle: null,
  voiceover: null,
  ...over,
});

describe('the timeline', () => {
  it('is stable when two clips claim the same place', () => {
    const a = clip({ id: 'a', order: 1 });
    const b = clip({ id: 'b', order: 1 });
    // 実行のたびに順番が変わると、書き出しが再現しない
    expect(timeline([b, a]).map((c) => c.id)).toEqual(['a', 'b']);
    expect(timeline([a, b]).map((c) => c.id)).toEqual(['a', 'b']);
  });

  it('lays the clips end to end', () => {
    const laid = layout([clip({ id: 'a', order: 1 }), clip({ id: 'b', order: 2 })]);
    expect(laid.map((c) => [c.startMs, c.endMs])).toEqual([
      [0, 2_000],
      [2_000, 4_000],
    ]);
    expect(totalDurationMs(laid)).toBe(4_000);
  });

  it('gives a clip with no length the default, rather than zero', () => {
    const laid = layout([clip({ id: 'a', order: 1, durationMs: null })]);
    // 0 にすると、指示があるのに一瞬も映らないクリップができる
    expect(laid[0]!.endMs).toBe(DEFAULT_CLIP_MS);
  });

  it('makes room between two clips without renumbering', () => {
    const between = orderBetween(1000, 2000);
    expect(between).toBeGreaterThan(1000);
    expect(between).toBeLessThan(2000);
    // 端も同じように扱える
    expect(orderBetween(null, 1000)).toBeLessThan(1000);
    expect(orderBetween(1000, null)).toBeGreaterThan(1000);
    expect(orderBetween(null, null)).toBe(1000);
  });
});

describe('subtitles', () => {
  it('writes cues only where there is something to say', () => {
    const vtt = toWebVtt([
      clip({ id: 'a', order: 1, subtitle: 'ここから' }),
      clip({ id: 'b', order: 2 }),
      clip({ id: 'c', order: 3, subtitle: 'ここまで' }),
    ]);
    expect(vtt.startsWith('WEBVTT')).toBe(true);
    expect(vtt).toContain('ここから');
    expect(vtt).toContain('ここまで');
    // 空 cue は字幕にも読み上げにも出てしまう
    expect(vtt.split('-->')).toHaveLength(3);
  });

  it('times the cues from the layout', () => {
    const vtt = toWebVtt([
      clip({ id: 'a', order: 1 }),
      clip({ id: 'b', order: 2, subtitle: '二つ目' }),
    ]);
    expect(vtt).toContain('00:00:02.000 --> 00:00:04.000');
  });

  it('is just a header when nothing is subtitled', () => {
    expect(toWebVtt([clip({ id: 'a', order: 1 })]).trim()).toBe('WEBVTT');
  });
});

describe('the voiceover script', () => {
  it('carries only the lines that exist, with their times', () => {
    const script = voiceoverScript([
      clip({ id: 'a', order: 1 }),
      clip({ id: 'b', order: 2, voiceover: '二つ目を読む' }),
    ]);
    // 無いところを「（無音）」で埋めると、読み上げにそのまま乗る
    expect(script).toEqual([{ at: 2_000, text: '二つ目を読む' }]);
  });
});

describe('the storyboard', () => {
  it('says what each frame is made from', () => {
    const frames = storyboard([
      clip({ id: 'a', order: 1 }),
      clip({ id: 'b', order: 2, prompt: null, sourceArtifactId: 'art-1' }),
      clip({ id: 'c', order: 3, prompt: null }),
    ]);
    expect(frames.map((f) => f.source)).toEqual(['指示から', '画像から', '未指定']);
  });
});

describe('before rendering', () => {
  it('says what is missing instead of quietly skipping it', () => {
    const problems = renderProblems([clip({ id: 'a', order: 1, prompt: null })]);
    expect(problems[0]).toContain('何を映すかの指示も元の画像もありません');
  });

  it('refuses an empty project', () => {
    expect(renderProblems([])).toContain('クリップがありません');
  });

  it('refuses a clip that lasts no time', () => {
    expect(renderProblems([clip({ id: 'a', order: 1, durationMs: 0 })])[0]).toContain('尺が 0');
  });

  it('is happy with a project that can actually be made', () => {
    expect(
      renderProblems([
        clip({ id: 'a', order: 1 }),
        clip({ id: 'b', order: 2, prompt: null, sourceArtifactId: 'art-1' }),
      ]),
    ).toEqual([]);
  });
});
