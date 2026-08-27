/**
 * 端末が落ちたときの止まり方。正本 §4.4。
 *
 * ここで見るのは、**待つべきものを失敗にしていないか**の一点。
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { HostOfflineError, isHostOfflineError } from '@astra/contracts';

const src = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src');

describe('host offline', () => {
  it('uses the same failure name on both sides of the sandbox', async () => {
    /*
     * workflows.ts は Temporal のサンドボックスで動くので契約を import できない。
     * 文字列を 2 箇所に置く以外に方法が無く、**ずれたら静かに壊れる**:
     * 端末が落ちただけの仕事が FAILED になる。だからここで縛る。
     */
    const workflow = await readFile(path.join(src, 'workflows.ts'), 'utf8');
    const declared = /const HOST_OFFLINE_TYPE = '([^']+)'/.exec(workflow)?.[1];
    expect(declared).toBe(HostOfflineError.TYPE);
  });

  it('does not retry an offline device at the activity level', async () => {
    // 再試行しても端末は戻らない。戻るのを待つのは workflow の仕事。
    const workflow = await readFile(path.join(src, 'workflows.ts'), 'utf8');
    const nonRetryable = workflow.slice(
      workflow.indexOf('nonRetryableErrorTypes'),
      workflow.indexOf('nonRetryableErrorTypes') + 900,
    );
    expect(nonRetryable).toContain('HOST_OFFLINE_TYPE');
  });

  it('tells an offline device apart from a real failure', () => {
    expect(isHostOfflineError(new HostOfflineError('端末が応答していません。'))).toBe(true);
    expect(isHostOfflineError(new Error('permission denied'))).toBe(false);
    expect(isHostOfflineError(null)).toBe(false);
  });

  it('does not walk down the fallback ladder when the device is merely away', async () => {
    /*
     * §24 の梯子は「試したが駄目だった」ときのもの。
     * PC を閉じただけで browser automation へ落ちると、
     * 利用者が選んでいない手段で外部操作が起きる。
     */
    const activities = await readFile(path.join(src, 'activities.ts'), 'utf8');
    const caught = activities.indexOf('} catch (error) {', activities.indexOf('const executor ='));
    const escalated = activities.indexOf('const escalation = await escalate', caught);
    const guarded = activities.indexOf('isHostOfflineError(error)', caught);
    expect(guarded).toBeGreaterThan(-1);
    // 梯子を降りる前に見ていること
    expect(guarded).toBeLessThan(escalated);
  });

  it('caps how long a task may sit paused', async () => {
    // 永久に PAUSED のまま残るなら、それは気づかれない失敗と同じ
    const workflow = await readFile(path.join(src, 'workflows.ts'), 'utf8');
    expect(workflow).toMatch(/MAX_HOST_WAIT_ROUNDS = \d+/);
    expect(workflow).toContain('round >= MAX_HOST_WAIT_ROUNDS');
  });

  it('answers "no device" when nothing is wired, rather than assuming one', async () => {
    const { createTaskActivities } = await import('../src/activities.js');
    const activities = createTaskActivities({
      db: null as never,
      library: null as never,
      publisher: null as never,
    });
    expect(
      await activities.hostAvailable({
        taskId: 't',
        tenantId: 'a',
        userId: 'u',
        kind: 'research',
        input: {},
      }),
    ).toBe(false);
  });
});
