/**
 * Lane Router。正本 §7.4、Phase 7 §2.1。
 * **利用者に Lane を見せない**が、なぜそうなったかは説明できる。
 */
import { describe, expect, it } from 'vitest';
import { routeLane } from '../src/lane.js';

const lane = (text: string, over: Record<string, unknown> = {}) =>
  routeLane({ text, modality: 'text', ...over } as never);

describe('routeLane', () => {
  it('sends a question that needs looking up to research', () => {
    for (const text of ['競合を調べて', '半導体市場を調査して', 'A社とB社を比較して']) {
      expect(lane(text).lane, text).toBe('research');
    }
  });

  it('sends an outward request to action', () => {
    for (const text of ['見積を送信して', '会議室を予約して', 'CRM を更新して']) {
      expect(lane(text).lane, text).toBe('action');
    }
  });

  it('only edits when there is something selected', () => {
    // 選択が無い「直して」は、何を直すか決まらない
    expect(lane('この文を短くして').lane).toBe('chat');
    expect(lane('この文を短くして', { hasSelection: true }).lane).toBe('edit');
  });

  it('treats anything said during a meeting as part of the meeting', () => {
    // ここで chat に落とすと、会議の途中で別の話が始まる
    expect(lane('売上はどうだった', { meetingActive: true }).lane).toBe('meeting');
  });

  it('picks meeting over action when asked to record one', () => {
    // 「記録して」は action にも見える。会議として先に拾う。
    expect(lane('会議を記録して').lane).toBe('meeting');
  });

  it('defers to a named agent above everything else', () => {
    expect(lane('調べて', { namedAgent: 'crm-analyst' }).lane).toBe('specialist-agent');
  });

  it('falls back to chat rather than guessing', () => {
    // 推測で振り分けない
    for (const text of ['こんにちは', 'ありがとう', 'うーん']) {
      expect(lane(text).lane, text).toBe('chat');
    }
  });

  it('can always say why', () => {
    for (const text of ['調べて', '送信して', 'こんにちは']) {
      expect(lane(text).reason.length, text).toBeGreaterThan(0);
    }
  });
});
