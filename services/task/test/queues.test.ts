/**
 * 仕事の種類ごとの列。正本 §26。
 *
 * 分けるのは、**一つの重い仕事が別の仕事を止めない**ため。
 * 分けたのに worker を用意し忘れると、仕事が誰にも拾われないので、
 * 既定では分けない。
 */
import { describe, expect, it } from 'vitest';
import { TASK_QUEUE, TASK_QUEUES, queueForKind } from '../src/runtime/types.js';

describe('queueForKind', () => {
  it('sends a long look-up to its own line', () => {
    expect(queueForKind('research')).toBe(TASK_QUEUES.research);
  });

  it('sends a meeting wrap-up to the slow line', () => {
    // 時間のかかる仕事を、短い仕事の列に並べない
    expect(queueForKind('meeting.finalize')).toBe(TASK_QUEUES.media);
  });

  it('sends anything a plugin brought to the domain line', () => {
    expect(queueForKind('plugin:com.acme.crm:analyst')).toBe(TASK_QUEUES.domain);
  });

  it('falls back to the general line rather than guessing', () => {
    // 推測で振り分けると、動かない worker の列に積まれて誰も気づかない
    for (const kind of ['echo', 'something.new', '']) {
      expect(queueForKind(kind), kind).toBe(TASK_QUEUES.general);
    }
  });

  it('keeps the general line as the one everything used to use', () => {
    // 既存の配備を壊さない
    expect(TASK_QUEUES.general).toBe(TASK_QUEUE);
  });

  it('gives every line a distinct name', () => {
    const names = Object.values(TASK_QUEUES);
    expect(new Set(names).size).toBe(names.length);
  });
});
