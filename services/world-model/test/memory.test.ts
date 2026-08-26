/**
 * 何を覚えて、何を覚えないか。正本 §10.3、Phase 6 実装仕様 §1.1。
 */
import { describe, expect, it } from 'vitest';
import { normalizeName, proactiveScore, uuidv7, type FactSource } from '@astra/contracts';
import { MIN_CONFIDENCE, shouldRemember } from '../src/memory.js';

const source: FactSource = { kind: 'user', stated_at: new Date().toISOString() } as FactSource;

describe('shouldRemember', () => {
  it('keeps what the policy lists', () => {
    for (const kind of [
      'preference',
      'commitment',
      'decision',
      'artifact_lineage',
      'task_status',
      'correction',
    ]) {
      const verdict = shouldRemember({ kind, statement: '10 月に導入する', source });
      expect(verdict.write, kind).toBe(true);
    }
  });

  it('refuses a kind the policy does not list', () => {
    // 「後で役に立つかもしれない」で溜めない
    const verdict = shouldRemember({ kind: 'small_talk', statement: '今日は暑いですね', source });
    expect(verdict).toMatchObject({ write: false });
    expect((verdict as { reason: string }).reason).toContain('small_talk');
  });

  it('refuses a fact with nothing to point at', () => {
    // 出所の無い記憶は作らない（D-43）
    const verdict = shouldRemember({ kind: 'commitment', statement: '見積を送る', source: null });
    expect(verdict).toMatchObject({ write: false });
    expect((verdict as { reason: string }).reason).toContain('source');
  });

  it('keeps temporary chat out of long-term memory', () => {
    const verdict = shouldRemember({
      kind: 'preference',
      statement: 'いまは静かにしていてほしい',
      source,
      ephemeral: true,
    });
    expect(verdict).toMatchObject({ write: false });
  });

  it('does not turn an acknowledgement into a commitment', () => {
    expect(shouldRemember({ kind: 'commitment', statement: 'はい', source })).toMatchObject({
      write: false,
    });
  });

  it('refuses an extraction it is not confident about', () => {
    // 曖昧な記憶は無いほうがまし
    expect(
      shouldRemember({
        kind: 'commitment',
        statement: 'たぶん来週やる',
        source,
        confidence: MIN_CONFIDENCE - 0.01,
      }),
    ).toMatchObject({ write: false });
  });

  it('always says why it declined', () => {
    const declined = [
      shouldRemember({ kind: 'gossip', statement: 'xxxx', source }),
      shouldRemember({ kind: 'commitment', statement: 'xxxx', source: null }),
      shouldRemember({ kind: 'commitment', statement: 'x', source }),
    ];
    for (const verdict of declined) {
      expect(verdict.write).toBe(false);
      expect((verdict as { reason: string }).reason.length).toBeGreaterThan(0);
    }
  });
});

describe('normalizeName', () => {
  it('brings the same person together', () => {
    // 同じ人が何人もできると、世界の「現在状態」にならない（D-45）
    expect(normalizeName('田中 太郎')).toBe(normalizeName('田中太郎'));
    expect(normalizeName('田中さん')).toBe(normalizeName('田中'));
    expect(normalizeName('株式会社アクメ')).toBe(normalizeName('アクメ'));
    expect(normalizeName('ACME')).toBe(normalizeName('acme'));
  });

  it('keeps different people apart', () => {
    expect(normalizeName('田中')).not.toBe(normalizeName('佐藤'));
  });
});

describe('proactiveScore', () => {
  it('subtracts the cost of interrupting', () => {
    // これが無いと「出せるものは全部出す」に退化する
    const base = { importance: 1, urgency: 1, confidence: 1, relevance: 1 };
    expect(proactiveScore({ ...base, interruptionCost: 0 })).toBe(1);
    expect(proactiveScore({ ...base, interruptionCost: 0.3 })).toBeCloseTo(0.7);
  });

  it('can decide that saying nothing is better', () => {
    expect(
      proactiveScore({
        importance: 0.3,
        urgency: 0.3,
        confidence: 0.5,
        relevance: 0.5,
        interruptionCost: 0.5,
      }),
    ).toBeLessThan(0);
  });

  it('drops to nothing when we are not confident', () => {
    const score = proactiveScore({
      importance: 1,
      urgency: 1,
      confidence: 0,
      relevance: 1,
      interruptionCost: 0,
    });
    expect(score).toBe(0);
    expect(uuidv7()).toBeTruthy();
  });
});
