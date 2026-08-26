/**
 * 読み上げへの通知と、押せる大きさ。UI/UX §19。
 */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MIN_TOUCH_TARGET_PX, TOKENS_CSS } from '@astra/ui-kit';
import { ANNOUNCE_INTERVAL_MS, LiveAnnouncer, announceable } from '../src/meeting/LiveAnnouncer.js';
import type { TranscriptLine } from '../src/meeting/meetingView.js';

afterEach(cleanup);

const line = (
  over: Partial<TranscriptLine> & Pick<TranscriptLine, 'id' | 'text'>,
): TranscriptLine =>
  ({
    speakerTag: 1,
    startMs: 0,
    endMs: 1_000,
    interim: false,
    translation: null,
    ...over,
  }) as TranscriptLine;

describe('what gets read out', () => {
  it('never hands an unfinished line to the screen reader', () => {
    const lines = [
      line({ id: 'a', text: '確定した発言' }),
      line({ id: 'b', text: 'にんし', interim: true }),
    ];
    // 認識中の文字は数百 ms ごとに書き換わる。流すと読み上げが割り込み続ける。
    expect(announceable(lines, new Set()).map((l) => l.text)).toEqual(['確定した発言']);
  });

  it('does not say the same line twice', () => {
    const lines = [line({ id: 'a', text: '一度目' })];
    expect(announceable(lines, new Set(['a']))).toEqual([]);
  });
});

describe('how often', () => {
  it('stays silent until asked for', () => {
    // §19 は「通知**可能**にする」。常に通知するではない。
    render(<LiveAnnouncer lines={[line({ id: 'a', text: 'こんにちは' })]} />);
    const region = document.querySelector('[aria-live]') as HTMLElement;
    expect(region.textContent).toBe('');
  });

  it('announces once turned on', () => {
    render(<LiveAnnouncer lines={[line({ id: 'a', text: 'こんにちは' })]} enabled />);
    expect(screen.getByText('こんにちは')).toBeTruthy();
  });

  it('holds back a second burst that arrives too soon', () => {
    let clock = 0;
    const { rerender } = render(
      <LiveAnnouncer lines={[line({ id: 'a', text: '一つ目' })]} enabled now={() => clock} />,
    );
    const region = document.querySelector('[aria-live]') as HTMLElement;
    expect(region.textContent).toBe('一つ目');

    clock = ANNOUNCE_INTERVAL_MS - 1;
    rerender(
      <LiveAnnouncer
        lines={[line({ id: 'a', text: '一つ目' }), line({ id: 'b', text: '二つ目' })]}
        enabled
        now={() => clock}
      />,
    );
    // 間隔を空ける。割り込みが積み上がると画面が使えなくなる。
    expect(region.textContent).toBe('一つ目');

    clock = ANNOUNCE_INTERVAL_MS + 1;
    rerender(
      <LiveAnnouncer
        lines={[
          line({ id: 'a', text: '一つ目' }),
          line({ id: 'b', text: '二つ目' }),
          line({ id: 'c', text: '三つ目' }),
        ]}
        enabled
        now={() => clock}
      />,
    );
    // 溜まっていたものは、まとめて 1 度だけ渡す
    expect(region.textContent).toBe('二つ目 三つ目');
  });

  it('does not interrupt a reading in progress', () => {
    render(<LiveAnnouncer lines={[line({ id: 'a', text: 'x' })]} enabled />);
    const region = document.querySelector('[aria-live]') as HTMLElement;
    expect(region.getAttribute('aria-live')).toBe('polite');
  });
});

describe('how big a control has to be (§19)', () => {
  it('gives every button a 44px hit area', () => {
    expect(MIN_TOUCH_TARGET_PX).toBe(44);
    expect(TOKENS_CSS).toContain(`min-height: ${MIN_TOUCH_TARGET_PX}px`);
    expect(TOKENS_CSS).toMatch(/button,\s*\[role='button'\]/);
  });

  it('leaves links inside a sentence alone', () => {
    // 文中のリンクまで 44px にすると行が壊れる
    expect(TOKENS_CSS).toMatch(/p a\[href\][\s\S]*min-height: 0/);
  });
});
