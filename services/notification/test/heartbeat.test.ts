/**
 * Proactive heartbeat。正本 §17・§2.1。
 *
 * **通知を増やす仕組みではない。**
 * 見に来た人へ出す基準で話しかけると、多すぎる。
 */
import { describe, expect, it, vi } from 'vitest';
import {
  SEVERITIES,
  interrupts,
  surfacesFor,
  type BriefItem,
  type DailyBrief,
} from '@astra/contracts';
import { Heartbeat, inQuietHours, shouldNotify } from '../src/heartbeat.js';

const item = (over: Partial<BriefItem> = {}): BriefItem =>
  ({
    id: 'commitment:1',
    severity: 'action-required',
    title: '見積を送る',
    detail: '2 日過ぎています',
    action_label: '確認する',
    target: { kind: 'commitment', fact_id: '00000000-0000-7000-8000-000000000000' },
    score: 0.8,
    ...over,
  }) as BriefItem;

const brief = (items: BriefItem[]): DailyBrief =>
  ({
    attention: items.slice(0, 3),
    more: items.slice(3),
    generated_at: new Date().toISOString(),
  }) as DailyBrief;

const NOON = new Date('2026-08-27T12:00:00');

describe('inQuietHours', () => {
  it('handles a window that crosses midnight', () => {
    expect(inQuietHours(23, { from: 22, to: 7 })).toBe(true);
    expect(inQuietHours(3, { from: 22, to: 7 })).toBe(true);
    expect(inQuietHours(12, { from: 22, to: 7 })).toBe(false);
  });

  it('is off when nothing was set', () => {
    expect(inQuietHours(3)).toBe(false);
  });
});

describe('shouldNotify', () => {
  it('holds a lower bar than the brief does', () => {
    // 見に来た人へ出す基準で話しかけると、多すぎる
    const quiet = shouldNotify(item({ score: 0.2 }), { now: NOON });
    expect(quiet.notify).toBe(false);
    expect(quiet.reason).toContain('below');
  });

  it('stays silent during quiet hours no matter how urgent', () => {
    const night = new Date('2026-08-27T02:00:00');
    const verdict = shouldNotify(item({ score: 1 }), {
      now: night,
      options: { quietHours: { from: 22, to: 7 } },
    });
    expect(verdict.notify).toBe(false);
    expect(verdict.reason).toBe('quiet hours');
  });

  it('still speaks at night when staying quiet would be worse (§16 critical)', () => {
    const night = new Date('2026-08-27T02:00:00');
    // 「録音に失敗した」を朝まで黙るのは、静かにする価値より高くつく
    const verdict = shouldNotify(item({ severity: 'critical', score: 1 }), {
      now: night,
      options: { quietHours: { from: 22, to: 7 } },
    });
    expect(verdict.notify).toBe(true);
  });

  it('does not say the same thing twice in a row', () => {
    const verdict = shouldNotify(item(), {
      now: NOON,
      lastSentAt: NOON.getTime() - 60_000,
    });
    expect(verdict.notify).toBe(false);
    expect(verdict.reason).toContain('already mentioned');
  });

  it('will say it again once enough time has passed', () => {
    const verdict = shouldNotify(item(), {
      now: NOON,
      lastSentAt: NOON.getTime() - 12 * 60 * 60 * 1000,
    });
    expect(verdict.notify).toBe(true);
  });

  it('always says why it stayed quiet', () => {
    for (const context of [
      { now: NOON, options: { minScore: 0.99 } },
      { now: NOON, lastSentAt: NOON.getTime() },
    ]) {
      const verdict = shouldNotify(item(), context);
      expect(verdict.notify).toBe(false);
      expect(verdict.reason.length).toBeGreaterThan(0);
    }
  });
});

describe('which surface a severity belongs on (§16)', () => {
  it('never lets Home-only news interrupt, however high it scores', () => {
    // 「調査が終わりました」で OS 通知を鳴らさない
    for (const severity of ['info', 'attention'] as const) {
      const verdict = shouldNotify(item({ severity, score: 1 }), { now: NOON });
      expect(verdict.notify).toBe(false);
      expect(verdict.reason).toContain('Home');
    }
  });

  it('lets an approval and a critical failure through', () => {
    for (const severity of ['action-required', 'critical'] as const) {
      expect(shouldNotify(item({ severity, score: 0.8 }), { now: NOON }).notify).toBe(true);
    }
  });

  it('maps every severity to the surfaces the table names', () => {
    expect(surfacesFor('info')).toEqual(['home']);
    expect(surfacesFor('attention')).toEqual(['home', 'badge']);
    expect(surfacesFor('action-required')).toEqual(['home', 'work_waiting', 'os_notification']);
    expect(surfacesFor('critical')).toEqual(['home', 'os_alert']);
  });

  it('puts every severity on Home, and only some beyond it', () => {
    for (const severity of SEVERITIES) {
      expect(surfacesFor(severity)).toContain('home');
    }
    expect(SEVERITIES.filter(interrupts)).toEqual(['action-required', 'critical']);
  });
});

describe('Heartbeat', () => {
  const sink = () => ({ push: vi.fn(async () => {}) });

  it('does not pour everything out at once', async () => {
    const out = sink();
    const beat = new Heartbeat({ sink: out, now: () => NOON });
    const sent = await beat.run(
      brief([
        item({ id: 'a', score: 0.9 }),
        item({ id: 'b', score: 0.85 }),
        item({ id: 'c', score: 0.8 }),
      ]),
    );
    // 既定は 1 件
    expect(sent).toHaveLength(1);
    expect(sent[0]!.item.id).toBe('a');
  });

  it('does not repeat what it already said', async () => {
    const out = sink();
    const beat = new Heartbeat({ sink: out, now: () => NOON });
    const first = brief([item({ id: 'a', score: 0.9 })]);

    expect(await beat.run(first)).toHaveLength(1);
    expect(await beat.run(first)).toHaveLength(0);
  });

  it('says it again after it has been forgotten', async () => {
    const beat = new Heartbeat({ sink: sink(), now: () => NOON });
    const one = brief([item({ id: 'a', score: 0.9 })]);
    await beat.run(one);
    beat.forget('a');
    expect(await beat.run(one)).toHaveLength(1);
  });

  it('does not count a failed push as having been said', async () => {
    const broken = {
      push: vi.fn(async () => {
        throw new Error('端末に届きませんでした');
      }),
    };
    const beat = new Heartbeat({ sink: broken, now: () => NOON });
    const one = brief([item({ id: 'a', score: 0.9 })]);

    expect(await beat.run(one)).toHaveLength(0);
    // 届かなかったのだから、次はまた試してよい
    broken.push = vi.fn(async () => {});
    expect(await beat.run(one)).toHaveLength(1);
  });

  it('says nothing at all when there is nothing worth saying', async () => {
    const out = sink();
    const beat = new Heartbeat({ sink: out, now: () => NOON });
    expect(await beat.run(brief([item({ score: 0.1 })]))).toHaveLength(0);
    expect(out.push).not.toHaveBeenCalled();
  });
});
