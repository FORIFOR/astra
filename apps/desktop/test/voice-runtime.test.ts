/**
 * 声の状態。UI/UX §4.1・§21。
 * runtime と UI を分けているので、畳み込みだけを純粋に試せる。
 */
import { describe, expect, it } from 'vitest';
import { createLevelStore, displayedText, foldTranscript } from '../src/voice/voiceRuntime.js';
import { orbStateFor } from '../src/voice/AstraOrb.js';

describe('levels the orb reads', () => {
  it('clamps to 0–1 and never throws on garbage', () => {
    const store = createLevelStore();
    store.set({ input: 1.7, output: -3 });
    expect(store.input()).toBe(1);
    expect(store.output()).toBe(0);
    store.set({ input: Number.NaN, output: 0.4 });
    expect(store.input()).toBe(0);
    expect(store.output()).toBe(0.4);
  });
});

describe('folding the transcript', () => {
  it('replaces the partial and keeps what was confirmed', () => {
    let s = { committed: '', partial: '' };
    s = foldTranscript(s, { type: 'partial', text: '来週の' });
    s = foldTranscript(s, { type: 'partial', text: '来週の打ち合わせ' });
    expect(displayedText(s)).toBe('来週の打ち合わせ');
    s = foldTranscript(s, { type: 'final', text: '来週の打ち合わせですが' });
    expect(s.committed).toBe('来週の打ち合わせですが');
    expect(s.partial).toBe('');
  });

  it('does not let a late partial erase a confirmed line', () => {
    let s = foldTranscript({ committed: '', partial: '' }, { type: 'final', text: '確定です' });
    s = foldTranscript(s, { type: 'partial', text: '古い' });
    // 確定は残り、partial は末尾に添えられるだけ
    expect(displayedText(s)).toBe('確定です古い');
    expect(s.committed).toBe('確定です');
  });

  it('spaces latin words but not japanese', () => {
    let s = foldTranscript({ committed: '', partial: '' }, { type: 'final', text: 'hello' });
    s = foldTranscript(s, { type: 'final', text: 'world' });
    expect(s.committed).toBe('hello world');
    s = foldTranscript({ committed: '', partial: '' }, { type: 'final', text: 'こんにちは' });
    s = foldTranscript(s, { type: 'final', text: '世界' });
    expect(s.committed).toBe('こんにちは世界');
  });

  it('ignores an empty final rather than adding nothing', () => {
    const s = foldTranscript({ committed: 'a', partial: 'x' }, { type: 'final', text: '   ' });
    expect(s).toEqual({ committed: 'a', partial: '' });
  });
});

describe('mapping our modes onto the orb', () => {
  it('shows talking only when we are speaking', () => {
    expect(orbStateFor('speaking')).toBe('talking');
    expect(orbStateFor('listening')).toBe('listening');
    expect(orbStateFor('thinking')).toBe('listening');
    expect(orbStateFor('idle')).toBe('idle');
    expect(orbStateFor('error')).toBe('idle');
  });
});
