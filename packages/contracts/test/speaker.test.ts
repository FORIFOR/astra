/**
 * 誰が話したか。正本 §11.3・§12.2。
 *
 * **出所が一次情報、話者分離は二次。**
 * いちばん避けたいのは「Speaker 1 と推測」「山田さんと推測」。
 */
import { describe, expect, it } from 'vitest';
import {
  ATTRIBUTION_LEVELS,
  attribute,
  isAttributed,
  sideFromSource,
  speakerLabel,
} from '../src/index.js';

describe('what the source alone tells us', () => {
  it('reads the microphone as self and the system as the other side', () => {
    expect(sideFromSource('microphone')).toBe('self');
    expect(sideFromSource('system')).toBe('other');
  });

  it('refuses to decide from a mixed track', () => {
    // 混合で「自分」と言うと、相手の発言が自分のものとして残る
    expect(sideFromSource('mixed')).toBeNull();
    expect(sideFromSource('whatever')).toBeNull();
  });
});

describe('stacking what is known', () => {
  it('goes no further than the evidence', () => {
    expect(attribute({}).level).toBe('unknown');
    expect(attribute({ source: 'microphone' }).level).toBe('side');
    expect(attribute({ source: 'system', speakerTag: 2 }).level).toBe('separated');
    expect(attribute({ source: 'system', speakerTag: 2, name: '山田' }).level).toBe('named');
  });

  it('keeps the side even when diarization failed', () => {
    // Google が落ちても、出所は残る
    const attribution = attribute({ source: 'system', speakerTag: null });
    expect(attribution.side).toBe('other');
    expect(attribution.speakerTag).toBeNull();
    expect(isAttributed(attribution)).toBe(true);
  });

  it('names only what was actually matched', () => {
    const guessless = attribute({ source: 'microphone', speakerTag: 1 });
    expect(guessless.name).toBeNull();
    expect(guessless.level).toBe('separated');
  });

  it('has a level for every step', () => {
    expect([...ATTRIBUTION_LEVELS]).toEqual(['unknown', 'side', 'separated', 'named']);
  });
});

describe('what the reader sees', () => {
  it('never writes "Speaker 1" for something it does not know', () => {
    expect(speakerLabel(attribute({}))).toBe('話者不明');
    // 混合音源も同じ。番号を作らない。
    expect(speakerLabel(attribute({ source: 'mixed' }))).toBe('話者不明');
  });

  it('says which side when only that is known', () => {
    expect(speakerLabel(attribute({ source: 'microphone' }))).toBe('自分');
    expect(speakerLabel(attribute({ source: 'system' }))).toBe('相手');
  });

  it('combines the side with the separated number', () => {
    expect(speakerLabel(attribute({ source: 'system', speakerTag: 2 }))).toBe('相手・Speaker 2');
    // 出所が分からなければ番号だけ
    expect(speakerLabel(attribute({ speakerTag: 3 }))).toBe('Speaker 3');
  });

  it('uses the name once it has really been matched', () => {
    expect(speakerLabel(attribute({ source: 'system', speakerTag: 2, name: '山田' }))).toBe('山田');
  });
});
