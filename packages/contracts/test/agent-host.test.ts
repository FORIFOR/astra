/**
 * 手元の実行基盤。正本 §4.4・§16.1。
 *
 * いちばん避けたいのは、**端末が落ちた瞬間に運営側のモデルへ乗り換えること。**
 * 利用者が選んだ経路と料金の外で処理が走る。
 */
import { describe, expect, it } from 'vitest';
import {
  HOST_OFFLINE_AFTER_MS,
  PAUSE_MESSAGE,
  PAUSE_REASONS,
  TASK_TRANSITIONS,
  canAutoResume,
  canDispatch,
  canTransition,
  dockStateFor,
  shouldPauseInsteadOfFallback,
  stateFromHeartbeat,
  type HostStatus,
} from '../src/index.js';

const NOW = Date.parse('2026-08-27T12:00:00.000Z');

const status = (over: Partial<HostStatus> = {}): HostStatus => ({
  state: 'online',
  lastSeenAt: new Date(NOW - 1_000).toISOString(),
  models: ['claude_code'],
  ...over,
});

describe('whether a job can be handed to the device', () => {
  it('needs a live host that has a model', () => {
    expect(canDispatch(status(), NOW)).toBe(true);
    expect(canDispatch(status({ models: [] }), NOW)).toBe(false);
    expect(canDispatch(status({ state: 'offline' }), NOW)).toBe(false);
  });

  it('does not treat "unknown" as online', () => {
    // 渡してから消えると、仕事は宙に浮く
    expect(canDispatch(status({ state: 'unknown' }), NOW)).toBe(false);
    expect(canDispatch(status({ lastSeenAt: null }), NOW)).toBe(false);
  });

  it('stops trusting a heartbeat that went quiet', () => {
    const stale = new Date(NOW - HOST_OFFLINE_AFTER_MS - 1).toISOString();
    expect(canDispatch(status({ lastSeenAt: stale }), NOW)).toBe(false);
  });
});

describe('reading the heartbeat', () => {
  it('is online while it is still recent', () => {
    expect(stateFromHeartbeat(new Date(NOW - 1_000).toISOString(), NOW)).toBe('online');
  });

  it('goes offline once it is old enough', () => {
    expect(stateFromHeartbeat(new Date(NOW - HOST_OFFLINE_AFTER_MS - 1).toISOString(), NOW)).toBe(
      'offline',
    );
  });

  it('says unknown rather than guessing', () => {
    expect(stateFromHeartbeat(null, NOW)).toBe('unknown');
    expect(stateFromHeartbeat('なにか', NOW)).toBe('unknown');
  });
});

describe('what happens when the device goes away', () => {
  it('pauses instead of switching provider', () => {
    // 乗り換えは「気を利かせた」ではなく、約束を破ったことになる
    expect(shouldPauseInsteadOfFallback(true, 'offline')).toBe(true);
    expect(shouldPauseInsteadOfFallback(true, 'unknown')).toBe(true);
  });

  it('leaves cloud-side work alone', () => {
    expect(shouldPauseInsteadOfFallback(false, 'offline')).toBe(false);
  });

  it('keeps running while the host is there', () => {
    expect(shouldPauseInsteadOfFallback(true, 'online')).toBe(false);
  });

  it('tells the user it will come back', () => {
    for (const reason of PAUSE_REASONS) {
      expect(PAUSE_MESSAGE[reason]).toContain('再開');
    }
  });
});

describe('coming back', () => {
  it('resumes on its own', () => {
    expect(canAutoResume('host_offline', false)).toBe(true);
  });

  it('does not walk past an approval that was waiting', () => {
    // 止まっている間に前提が変わっていることがある
    expect(canAutoResume('host_offline', true)).toBe(false);
  });
});

describe('the paused status', () => {
  it('is not a failure', () => {
    // 失敗にすると、利用者は最初からやり直す
    expect(canTransition('RUNNING', 'PAUSED_HOST_OFFLINE')).toBe(true);
    expect(TASK_TRANSITIONS.PAUSED_HOST_OFFLINE).not.toContain('FAILED');
  });

  it('goes back to running, or is cancelled by a person', () => {
    expect(canTransition('PAUSED_HOST_OFFLINE', 'RUNNING')).toBe(true);
    expect(canTransition('PAUSED_HOST_OFFLINE', 'CANCELLED')).toBe(true);
  });

  it('still shows as work in progress', () => {
    // 失敗の面へ落とすと「やり直さないといけない」と読まれる
    expect(dockStateFor('PAUSED_HOST_OFFLINE')).toBe('WORKING');
  });
});
