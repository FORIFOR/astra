/**
 * Local Agent Host。正本 §4.4・§16.1。
 *
 * 守りたいのは 4 つ:
 *   - 同じ仕事を二重に走らせない
 *   - 借りたままにしない
 *   - モデルが無いのに引き受けない
 *   - 貸し出しを失ったら止まる
 */
import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_HEARTBEAT_MS, LocalAgentHost, type HostTransport } from '../src/host.js';
import { HOST_OFFLINE_AFTER_MS } from '@astra/contracts';

function fakeTransport(over: Partial<HostTransport> = {}): HostTransport & {
  calls: string[];
} {
  const calls: string[] = [];
  return {
    calls,
    async heartbeat() {
      calls.push('heartbeat');
      return { id: 'host-1' };
    },
    async claim(taskId) {
      calls.push(`claim:${taskId}`);
      return { leaseId: 'lease-1', attempt: 1 };
    },
    async renew(taskId) {
      calls.push(`renew:${taskId}`);
    },
    async release(taskId) {
      calls.push(`release:${taskId}`);
    },
    async checkpoint(taskId, _leaseId, stepIndex) {
      calls.push(`checkpoint:${taskId}:${stepIndex}`);
    },
    ...over,
  };
}

const noopRunner = { run: async () => undefined };

describe('heartbeating', () => {
  it('beats often enough not to be called offline by one miss', () => {
    // 1 回落としただけで offline にされない余裕
    expect(DEFAULT_HEARTBEAT_MS * 2).toBeLessThan(HOST_OFFLINE_AFTER_MS);
  });

  it('registers before it does anything else', async () => {
    const transport = fakeTransport();
    const host = new LocalAgentHost({
      deviceLabel: 'mac',
      models: ['claude_code'],
      transport,
      runner: noopRunner,
    });
    expect(host.hostId).toBeNull();
    await host.start();
    expect(host.hostId).toBe('host-1');
    await host.stop();
  });

  it('keeps going when one heartbeat fails', async () => {
    const errors: Error[] = [];
    let beats = 0;
    const transport = fakeTransport({
      async heartbeat() {
        beats += 1;
        if (beats === 2) throw new Error('network down');
        return { id: 'host-1' };
      },
    });
    const host = new LocalAgentHost({
      deviceLabel: 'mac',
      models: ['m'],
      transport,
      runner: noopRunner,
      heartbeatMs: 1,
      onError: (error) => errors.push(error),
    });
    await host.start();
    await new Promise((resolve) => setTimeout(resolve, 25));
    await host.stop();
    // 落ちても止めない。続けて落ちれば、サーバ側が offline にする
    expect(errors.some((e) => e.message.includes('network down'))).toBe(true);
    expect(beats).toBeGreaterThan(2);
  });
});

describe('accepting a job', () => {
  it('refuses before registering', async () => {
    const host = new LocalAgentHost({
      deviceLabel: 'mac',
      models: ['m'],
      transport: fakeTransport(),
      runner: noopRunner,
    });
    const outcome = await host.accept('task-1');
    expect(outcome.accepted).toBe(false);
    expect(outcome.reason).toContain('名乗って');
  });

  it('refuses when this device has no model', async () => {
    const host = new LocalAgentHost({
      deviceLabel: 'mac',
      models: [],
      transport: fakeTransport(),
      runner: noopRunner,
    });
    await host.start();
    const outcome = await host.accept('task-1');
    // 受けてから失敗するより、受けないほうがよい
    expect(outcome.accepted).toBe(false);
    expect(outcome.reason).toContain('モデル');
    await host.stop();
  });

  it('does not take the same job twice', async () => {
    const transport = fakeTransport();
    let release!: () => void;
    const host = new LocalAgentHost({
      deviceLabel: 'mac',
      models: ['m'],
      transport,
      runner: {
        run: () => new Promise<void>((resolve) => (release = resolve)),
      },
    });
    await host.start();

    const first = host.accept('task-1');
    await new Promise((resolve) => setImmediate(resolve));
    const second = await host.accept('task-1');

    // 二重に走らせると、外部への操作が二度起きる
    expect(second.accepted).toBe(false);
    expect(second.reason).toContain('すでに');
    release();
    await first;
    expect(transport.calls.filter((c) => c === 'claim:task-1')).toHaveLength(1);
    await host.stop();
  });

  it('checkpoints and renews as the work advances', async () => {
    const transport = fakeTransport();
    const host = new LocalAgentHost({
      deviceLabel: 'mac',
      models: ['m'],
      transport,
      runner: {
        async run({ onStep }) {
          await onStep(1, { searched: ['a'] });
          await onStep(2, { searched: ['a', 'b'] });
        },
      },
    });
    await host.start();
    await host.accept('task-1');

    expect(transport.calls).toContain('checkpoint:task-1:1');
    expect(transport.calls).toContain('checkpoint:task-1:2');
    // 長い仕事の途中で貸し出しが切れないよう、進むたびに延ばす
    expect(transport.calls.filter((c) => c === 'renew:task-1')).toHaveLength(2);
    await host.stop();
  });

  it('returns the lease even when the work threw', async () => {
    const transport = fakeTransport();
    const host = new LocalAgentHost({
      deviceLabel: 'mac',
      models: ['m'],
      transport,
      runner: {
        async run() {
          throw new Error('the work failed');
        },
      },
    });
    await host.start();
    await expect(host.accept('task-1')).rejects.toThrow('the work failed');
    // 借りたままにしない
    expect(transport.calls).toContain('release:task-1');
    expect(host.runningTasks).toEqual([]);
    await host.stop();
  });

  it('tells the work when the lease is gone', async () => {
    const transport = fakeTransport();
    let sawLoss = false;
    const host = new LocalAgentHost({
      deviceLabel: 'mac',
      models: ['m'],
      transport,
      runner: {
        async run({ stillLeased }) {
          expect(stillLeased()).toBe(true);
          await host.stop();
          // 失っていたら止める
          sawLoss = !stillLeased();
        },
      },
    });
    await host.start();
    await host.accept('task-1');
    expect(sawLoss).toBe(true);
  });

  it('gives back everything it holds when it stops', async () => {
    const transport = fakeTransport();
    const host = new LocalAgentHost({
      deviceLabel: 'mac',
      models: ['m'],
      transport,
      runner: {
        run: () =>
          new Promise<void>((resolve) => {
            setTimeout(resolve, 5);
          }),
      },
    });
    await host.start();
    const running = host.accept('task-1');
    await new Promise((resolve) => setImmediate(resolve));
    expect(host.runningTasks).toEqual(['task-1']);
    await host.stop();
    expect(transport.calls).toContain('release:task-1');
    await running;
  });
});

describe('what the host is not', () => {
  it('has no way to run an arbitrary command', () => {
    const host = new LocalAgentHost({
      deviceLabel: 'mac',
      models: ['m'],
      transport: fakeTransport(),
      runner: noopRunner,
    });
    /*
     * 任意コマンド実行の口を作らない。
     * 増やすときは、増やす理由を先に決めること。
     */
    const surface = Object.getOwnPropertyNames(Object.getPrototypeOf(host)).sort();
    expect(surface).toEqual(['accept', 'constructor', 'hostId', 'runningTasks', 'start', 'stop']);
    expect(surface).not.toContain('exec');
    expect(surface).not.toContain('run');
  });
});
