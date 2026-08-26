/**
 * 失敗したときの登り方。正本 §9.3・§24。
 *
 * 見たいのは 1 つ:
 * **「試したが駄目だった」と「試せる手段が無かった」を混ぜないこと。**
 */
import { describe, expect, it } from 'vitest';
import {
  ESCALATION_RUNGS,
  RUNG_LABEL,
  handoffExplanation,
  reachedHandoff,
  rungsBefore,
  type EscalationTrail,
} from '../src/index.js';

const trail = (steps: EscalationTrail['steps']): EscalationTrail => ({ steps });

describe('the ladder', () => {
  it('is the order the spec writes', () => {
    expect([...ESCALATION_RUNGS]).toEqual([
      'retry',
      'alternate_connector',
      'browser_automation',
      'screen_automation',
      'user_handoff',
    ]);
  });

  it('puts user handoff last', () => {
    expect(rungsBefore('user_handoff')).toHaveLength(ESCALATION_RUNGS.length - 1);
    expect(rungsBefore('retry')).toEqual([]);
  });

  it('gives every rung something to say to the user', () => {
    for (const rung of ESCALATION_RUNGS) {
      expect(RUNG_LABEL[rung].length).toBeGreaterThan(0);
      // 内部の呼び名をそのまま出さない
      expect(RUNG_LABEL[rung]).not.toMatch(/automation|connector/);
    }
  });
});

describe('what the person is told when it reaches them', () => {
  it('names what was tried and what was missing', () => {
    const text = handoffExplanation(
      trail([
        { rung: 'retry', outcome: 'failed', reason: null },
        { rung: 'alternate_connector', outcome: 'failed', reason: null },
        {
          rung: 'browser_automation',
          outcome: 'unavailable',
          reason: 'この環境に繋がっていません',
        },
        { rung: 'screen_automation', outcome: 'unavailable', reason: 'この環境に繋がっていません' },
      ]),
    );
    expect(text).toContain('もう一度試す');
    expect(text).toContain('別の経路で試す');
    // 持っていないものを、試して駄目だったことにしない
    expect(text).toContain('ブラウザを操作して試すは使えません');
    expect(text).toContain('この環境に繋がっていません');
  });

  it('does not claim to have tried what it never had', () => {
    const text = handoffExplanation(
      trail([
        { rung: 'retry', outcome: 'failed', reason: null },
        {
          rung: 'alternate_connector',
          outcome: 'unavailable',
          reason: 'この操作に代わりの経路が宣言されていません',
        },
      ]),
    );
    expect(text).toContain('もう一度試す');
    expect(text).not.toContain('別の経路で試しました');
    expect(text).toContain('宣言されていません');
  });

  it('says so plainly when there was nothing to try', () => {
    expect(handoffExplanation(trail([]))).toBe('試せる手段がありませんでした。');
  });

  it('always gives a reason for something it could not use', () => {
    const text = handoffExplanation(
      trail([{ rung: 'screen_automation', outcome: 'unavailable', reason: null }]),
    );
    // 理由が無いことも黙らない
    expect(text).toContain('理由不明');
  });
});

describe('where it ended up', () => {
  it('knows whether it reached a person', () => {
    expect(reachedHandoff(trail([{ rung: 'retry', outcome: 'failed', reason: null }]))).toBe(false);
    expect(
      reachedHandoff(trail([{ rung: 'user_handoff', outcome: 'not_reached', reason: null }])),
    ).toBe(true);
  });
});
