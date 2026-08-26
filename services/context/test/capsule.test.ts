/**
 * Context Capsule。正本 §6.3、Phase 7 §1。
 *
 * **raw なローカルデータをそのまま外へ出さない**ことを確かめる。
 */
import { describe, expect, it } from 'vitest';
import type { ContextSource } from '@astra/contracts';
import {
  buildCapsule,
  containsRawLocalData,
  decideEgress,
  highestSensitivity,
} from '../src/capsule.js';

const source = (over: Partial<ContextSource> = {}): ContextSource =>
  ({
    id: 'a',
    category: 'current',
    label: 'Q4提案.pptx',
    reason: null,
    sensitivity: 'PRIVATE',
    removable: true,
    used: true,
    ...over,
  }) as ContextSource;

const local = {
  activeApp: 'Keynote',
  windowTitle: 'Q4提案.pptx — Keynote',
  selectedText: '来期の売上目標は 120 億円',
  currentUrl: 'https://intranet.example.com/secret',
  clipboard: 'パスワード: hunter2',
};

describe('buildCapsule', () => {
  it('does not carry the selection unless it was shared', () => {
    // 選択しただけで中身が出ていってはいけない
    const quiet = buildCapsule({ intent: '要約して', local });
    expect(quiet.selected_text).toBeNull();

    const shared = buildCapsule({ intent: '要約して', local, selectionShared: true });
    expect(shared.selected_text).toBe('来期の売上目標は 120 億円');
  });

  it('never carries the clipboard or the URL', () => {
    // Capsule にその口が無い。載っていたら組み立てが壊れている。
    const capsule = buildCapsule({ intent: 'x', local, selectionShared: true });
    expect(JSON.stringify(capsule)).not.toContain('hunter2');
    expect(JSON.stringify(capsule)).not.toContain('/secret');
    expect(containsRawLocalData(capsule, local)).toBe(false);
  });

  it('summarizes the window title instead of passing it whole', () => {
    const capsule = buildCapsule({ intent: 'x', local });
    // アプリ名まで持ち出さない
    expect(capsule.window_title).toBe('Q4提案.pptx');
  });

  it('only attaches what was explicitly named', () => {
    // 「役に立ちそう」で足すと、添付した覚えのないものが出ていく
    const capsule = buildCapsule({ intent: 'x', local, attachments: ['artifact:1'] });
    expect(capsule.allowed_raw_attachments).toEqual(['artifact:1']);
  });

  it('caps how much it will carry', () => {
    const many = Array.from({ length: 40 }, (_, i) => `ref-${i}`);
    const capsule = buildCapsule({ intent: 'x', referents: many, attachments: many });
    expect(capsule.referents).toHaveLength(20);
    expect(capsule.allowed_raw_attachments).toHaveLength(20);
  });
});

describe('sensitivity', () => {
  it('takes the highest of what it contains, not the lowest', () => {
    // 低いほうに寄せると、REGULATED を含む束が PRIVATE として出ていく
    expect(
      highestSensitivity([
        source({ sensitivity: 'PUBLIC' }),
        source({ sensitivity: 'REGULATED' }),
        source({ sensitivity: 'PRIVATE' }),
      ]),
    ).toBe('REGULATED');
  });

  it('does not fall below PRIVATE just because everything is public', () => {
    expect(highestSensitivity([source({ sensitivity: 'PUBLIC' })])).toBe('PRIVATE');
  });

  it('is carried onto the capsule', () => {
    const capsule = buildCapsule({
      intent: 'x',
      sources: [source({ sensitivity: 'CONFIDENTIAL' })],
    });
    expect(capsule.sensitivity).toBe('CONFIDENTIAL');
  });
});

describe('decideEgress', () => {
  it('keeps regulated context on the device while no policy can judge it', () => {
    const capsule = buildCapsule({ intent: 'x', sources: [source({ sensitivity: 'REGULATED' })] });
    const decision = decideEgress(capsule);
    expect(decision.allowed).toBe(false);
    expect(decision.capsule).toBeNull();
    expect(decision.reason).toContain('REGULATED');
  });

  it('lets it through once something has judged it', () => {
    const capsule = buildCapsule({ intent: 'x', sources: [source({ sensitivity: 'REGULATED' })] });
    expect(decideEgress(capsule, { regulatedAllowed: true }).allowed).toBe(true);
  });

  it('lets ordinary context through', () => {
    for (const sensitivity of ['PUBLIC', 'PRIVATE', 'CONFIDENTIAL'] as const) {
      const capsule = buildCapsule({ intent: 'x', sources: [source({ sensitivity })] });
      expect(decideEgress(capsule).allowed, sensitivity).toBe(true);
    }
  });
});
