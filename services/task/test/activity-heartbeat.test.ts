import { MockActivityEnvironment } from '@temporalio/testing';
import { expect, it } from 'vitest';
import { withActivityHeartbeat } from '../src/activity-heartbeat.js';
const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
it('reports progress throughout a slow step and stops after completion', async () => {
  const env = new MockActivityEnvironment();
  const beats: unknown[] = [];
  env.on('heartbeat', (value) => beats.push(value));
  expect(
    await env.run(() =>
      withActivityHeartbeat(async () => {
        await wait(75);
        return 'saved';
      }, 10),
    ),
  ).toBe('saved');
  expect(beats.length).toBeGreaterThanOrEqual(3);
  const count = beats.length;
  await wait(30);
  expect(beats).toHaveLength(count);
});
it('does not retry a failed operation or leave its timer alive', async () => {
  const env = new MockActivityEnvironment();
  let calls = 0,
    beats = 0;
  env.on('heartbeat', () => beats++);
  await expect(
    env.run(() =>
      withActivityHeartbeat(async () => {
        calls++;
        await wait(25);
        throw new Error('provider failed');
      }, 10),
    ),
  ).rejects.toThrow('provider failed');
  const count = beats;
  await wait(30);
  expect(beats).toBe(count);
  expect(calls).toBe(1);
});
