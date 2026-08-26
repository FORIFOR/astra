/**
 * 指示語の解決。正本 §7.2、Phase 7 §2.2。
 * **解決できないものを埋めない**（D-49）。
 */
import { describe, expect, it } from 'vitest';
import { uuidv7, type Referent } from '@astra/contracts';
import { clarificationFor, fullyResolved, remember, resolveReferences } from '../src/reference.js';

const ref = (label: string): Referent =>
  ({
    index: 0,
    label,
    target: { kind: 'artifact', artifact_id: uuidv7() },
  }) as Referent;

describe('resolveReferences', () => {
  it('resolves "それ" to the most recent thing', () => {
    const recent = ref('Q4提案');
    const [resolution] = resolveReferences('それを共有して', { referents: [recent] });
    expect(resolution!.resolved?.label).toBe('Q4提案');
  });

  it('leaves "それ" unresolved when nothing has been mentioned', () => {
    // 埋めると、別のものに対して動く
    const [resolution] = resolveReferences('それを削除して', { referents: [] });
    expect(resolution!.resolved).toBeNull();
    expect(resolution!.reason).toContain('nothing has been referred to');
  });

  it('counts "2番" from the list that was shown', () => {
    const list = [ref('一つ目'), ref('二つ目'), ref('三つ目')];
    const [resolution] = resolveReferences('2番を開いて', { referents: [], lastList: list });
    expect(resolution!.resolved?.label).toBe('二つ目');
  });

  it('refuses to guess when the number is out of range', () => {
    const list = [ref('一つ目')];
    const [resolution] = resolveReferences('5番を開いて', { referents: [], lastList: list });
    expect(resolution!.resolved).toBeNull();
    expect(resolution!.reason).toContain('only 1 item');
  });

  it('does not pretend to know what "昨日の続き" means', () => {
    const [resolution] = resolveReferences('昨日の続きをやって', {
      referents: [ref('何か')],
    });
    // 直近を当てにいかない。時間で遡る材料がここには無い。
    expect(resolution!.resolved).toBeNull();
  });

  it('reports the phrases it could not resolve, not just that it failed', () => {
    const resolutions = resolveReferences('それの2番を開いて', { referents: [] });
    expect(resolutions.length).toBeGreaterThan(1);
    expect(fullyResolved(resolutions)).toBe(false);
  });

  it('finds nothing when there is nothing to find', () => {
    expect(resolveReferences('競合を調べて', { referents: [ref('x')] })).toEqual([]);
  });
});

describe('clarificationFor', () => {
  it('says nothing when everything resolved', () => {
    // 文脈から分かることを聞き返さない（正本 §7.2）
    const resolutions = resolveReferences('それを共有して', { referents: [ref('Q4提案')] });
    expect(clarificationFor(resolutions)).toBeNull();
  });

  it('asks only about the part it could not resolve', () => {
    const resolutions = resolveReferences('それを共有して', { referents: [] });
    const question = clarificationFor(resolutions)!;
    // 「何について？」と丸ごと聞き直さない
    expect(question).toContain('それ');
    expect(question).not.toContain('共有');
  });
});

describe('remember', () => {
  it('puts the newest first', () => {
    const a = ref('A');
    const b = ref('B');
    const list = remember(remember([], a), b);
    expect(list.map((r) => r.label)).toEqual(['B', 'A']);
    expect(list.map((r) => r.index)).toEqual([0, 1]);
  });

  it('moves something already known to the front instead of duplicating it', () => {
    const a = ref('A');
    const list = remember(remember(remember([], a), ref('B')), a);
    expect(list.map((r) => r.label)).toEqual(['A', 'B']);
  });

  it('forgets the oldest rather than growing without bound', () => {
    let list: Referent[] = [];
    for (let i = 0; i < 30; i += 1) list = remember(list, ref(`item-${i}`));
    expect(list).toHaveLength(20);
    expect(list[0]!.label).toBe('item-29');
  });
});

describe('what is on screen (正本 §6)', () => {
  it('resolves "この会社" from what the user is looking at', () => {
    // 会話に出ていなくても、画面に出ていれば説明し直させない
    const resolutions = resolveReferences('この会社について調べて', {
      referents: [],
      contextLabels: ['Example Inc'],
    });
    expect(clarificationFor(resolutions)).toBeNull();
  });

  it('still asks when there is nothing on screen either', () => {
    const resolutions = resolveReferences('この会社について調べて', { referents: [] });
    expect(clarificationFor(resolutions)).not.toBeNull();
  });

  it('does not treat a standalone pronoun as resolved by the screen', () => {
    // 「それ」は名詞を取らない。画面に何かあっても、どれかは決まらない。
    const resolutions = resolveReferences('それを消して', {
      referents: [],
      contextLabels: ['Example Inc'],
    });
    expect(clarificationFor(resolutions)).not.toBeNull();
  });
});
