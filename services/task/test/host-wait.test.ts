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

describe('the waits actually fire', () => {
  it('gives every condition() a numeric timeout', async () => {
    /*
     * `condition(fn, '1 minute')` は待たずに固まっていた。文字列を
     * どこで解釈するかが増えるほど、こういう黙った故障が入りやすい。
     *
     * 効かなかったのは 2 箇所で、どちらも**待つことが仕事**だった:
     *   - 端末の復帰待ち  → 止まった仕事が永久に戻らない
     *   - 承認待ちの期限  → 承認待ちが永久に切れない
     */
    const workflow = await readFile(path.join(src, 'workflows.ts'), 'utf8');
    const timeouts = [...workflow.matchAll(/await condition\(\s*[^,]+,\s*([^)]+)\)/g)].map((m) =>
      m[1]!.trim(),
    );
    expect(timeouts.length).toBeGreaterThan(0);
    for (const timeout of timeouts) {
      expect(timeout, `condition() の待ち時間が文字列: ${timeout}`).not.toMatch(/^['"]/);
    }
  });

  it('starts checking again quickly, then backs off', async () => {
    // 蓋を閉じて開けただけの不在で、まるまる 1 分止めない
    const workflow = await readFile(path.join(src, 'workflows.ts'), 'utf8');
    expect(workflow).toMatch(/HOST_POLL_START_MS = \d/);
    expect(workflow).toMatch(/HOST_POLL_MAX_MS = \d/);
    expect(workflow).toContain('Math.min(interval * 2, HOST_POLL_MAX_MS)');
  });

  it('looks for the device before sleeping', async () => {
    const workflow = await readFile(path.join(src, 'workflows.ts'), 'utf8');
    const body = workflow.slice(workflow.indexOf('async function waitForHost'));
    const check = body.indexOf('persistence.hostAvailable');
    const sleep = body.indexOf('await condition(');
    expect(check).toBeGreaterThan(-1);
    expect(check).toBeLessThan(sleep);
  });
});

describe('a tool nobody implements', () => {
  it('refuses instead of reporting success', async () => {
    /*
     * ここは長らく「登録が無ければ何もしない」だった。Phase 0 の echo の
     * ための逃がし口だったが、**manifest が宣言した tool にも効いていた。**
     * Sales CRM の 2 つは宣言だけで実装が無く、走らせると
     * `{ echoed: null }` を返して**完了**していた。
     * 画面には「完了」と出て、成果物は無い。
     */
    const activities = await readFile(path.join(src, 'activities.ts'), 'utf8');
    expect(activities).toContain("!step.toolId.startsWith('noop.')");
    expect(activities).toContain('ToolNotImplemented');
  });

  it('does not retry a tool that does not exist', async () => {
    const workflow = await readFile(path.join(src, 'workflows.ts'), 'utf8');
    const list = workflow.slice(
      workflow.indexOf('nonRetryableErrorTypes'),
      workflow.indexOf('nonRetryableErrorTypes') + 1000,
    );
    // 再試行しても実装は現れない
    expect(list).toContain('ToolNotImplemented');
  });

  it('still lets the built-in echo through', async () => {
    // Phase 0 の受け入れは noop.echo を通す。ここを塞ぐと通らなくなる。
    const plan = await readFile(path.join(src, 'plan.ts'), 'utf8');
    expect(plan).toContain("toolId: 'noop.echo'");
  });
});

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
