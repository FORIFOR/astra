import { afterEach, expect, it } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { acquireHostInstance, instancePort } from '../src/instance-lock.js';
let child: ChildProcess | undefined;
afterEach(() => {
  child?.kill('SIGKILL');
  child = undefined;
});
it('holds one lock, refuses a duplicate, and releases for a restart', async () => {
  const first = await acquireHostInstance('test', 0);
  try {
    await expect(acquireHostInstance('test', first.port)).rejects.toThrow('起動ロック');
  } finally {
    await first.release();
  }
  const restarted = await acquireHostInstance('test', first.port);
  await restarted.release();
  expect(instancePort('a')).toBe(instancePort('a'));
});
it('recovers the lock through the OS after a process crashes', async () => {
  child = spawn(
    process.execPath,
    [
      '-e',
      "const s=require('node:net').createServer();s.listen(0,'127.0.0.1',()=>console.log(s.address().port))",
    ],
    { stdio: ['ignore', 'pipe', 'ignore'] },
  );
  const [data] = await once(child.stdout!, 'data');
  const port = Number(String(data).trim());
  await expect(acquireHostInstance('crash', port)).rejects.toThrow('起動ロック');
  const exited = once(child, 'exit');
  child.kill('SIGKILL');
  await exited;
  const restarted = await acquireHostInstance('crash', port);
  await restarted.release();
});
