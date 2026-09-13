import { spawn } from 'node:child_process';
import { open } from 'node:fs/promises';
import { join } from 'node:path';

export class OwnedProcesses {
  constructor({ cwd, logs, signal, onFailure = () => {} }) {
    this.cwd = cwd;
    this.logs = logs;
    this.signal = signal;
    this.onFailure = onFailure;
    this.children = new Set();
    this.stopping = false;
  }

  async spawn(name, executable, args, env, { input, service = false, timeout = 0 } = {}) {
    this.signal?.throwIfAborted();
    const log = await open(join(this.logs, `${name}.log`), 'a', 0o600);
    if (this.signal?.aborted || this.stopping) {
      await log.close();
      throw new Error('起動を中断しました。');
    }
    const child = spawn(executable, args, {
      cwd: this.cwd,
      env,
      detached: process.platform !== 'win32',
      stdio: [input === undefined ? 'ignore' : 'pipe', log.fd, log.fd, ...(service ? ['ipc'] : [])],
    });
    this.children.add(child);
    let timer;
    child.done = new Promise((accept) => {
      let finished = false;
      const finish = (code) => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        this.children.delete(child);
        if (service && !this.stopping)
          this.onFailure(
            new Error(
              `${name}が終了しました。${name}.log を確認し、同じ起動コマンドで再実行してください。`,
            ),
          );
        accept(code);
      };
      child.once('error', () => finish(1));
      child.once('exit', (code) => finish(code ?? 1));
    });
    child.stdin?.on('error', () => {});
    if (input !== undefined) child.stdin.end(input);
    if (timeout) timer = setTimeout(() => this.kill(child, 'SIGKILL'), timeout);
    await log.close();
    return child;
  }

  kill(child, signal) {
    if (!child.pid || child.exitCode !== null || child.signalCode !== null) return;
    try {
      if (process.platform === 'win32') child.kill(signal);
      else process.kill(-child.pid, signal);
    } catch {
      /* Only this invocation's process group is ever targeted. */
    }
  }

  async run(name, executable, args, env, options = {}) {
    const child = await this.spawn(name, executable, args, env, options);
    const code = await child.done;
    this.signal?.throwIfAborted();
    if (code !== 0)
      throw new Error(`${name}を完了できませんでした。${name}.log を確認してください。`);
  }

  async stop() {
    this.stopping = true;
    const children = [...this.children].reverse();
    for (const child of children) this.kill(child, 'SIGTERM');
    const deadline = setTimeout(() => {
      for (const child of children) this.kill(child, 'SIGKILL');
    }, 15_000);
    await Promise.all(children.map((child) => child.done));
    clearTimeout(deadline);
  }
}

export async function waitFor(
  check,
  {
    timeout = 120_000,
    interval = 1000,
    signal,
    message = '準備が時間内に完了しませんでした。',
  } = {},
) {
  const until = Date.now() + timeout;
  while (Date.now() < until) {
    signal?.throwIfAborted();
    try {
      if (await check()) return;
    } catch {
      /* A dependency can still be starting. */
    }
    await new Promise((accept) => setTimeout(accept, interval));
  }
  signal?.throwIfAborted();
  throw new Error(message);
}

export async function jsonRequest(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    redirect: 'error',
    signal: options.signal ?? AbortSignal.timeout(8000),
  });
  if (!response.ok) throw new Error(`ローカルサービスの応答: HTTP ${response.status}`);
  const chunks = [];
  let bytes = 0;
  for await (const chunk of response.body) {
    bytes += chunk.length;
    if (bytes > 1024 * 1024) throw new Error('ローカルサービスの応答が大きすぎます。');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
