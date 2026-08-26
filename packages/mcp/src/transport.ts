/**
 * MCP のトランスポート。正本 §9.1（local-MCP / cloud-MCP）。
 *
 * どちらも **1 往復 = 1 呼び出し**の形に揃えてある。
 * MCP の通知（notification）は使わないので、待ち合わせを持たない。
 */
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { AstraError } from '@astra/contracts';
import type { McpTransportChannel } from './protocol.js';

/** 1 往復の上限。応答しないサーバで固まらないため。 */
export const MCP_TIMEOUT_MS = 30_000;

/** 1 メッセージの上限。無限に流し込まれてメモリを食い潰さないため。 */
export const MAX_MESSAGE_BYTES = 4 * 1024 * 1024;

export interface StdioOptions {
  readonly command: string;
  readonly args?: readonly string[];
  readonly timeoutMs?: number;
  /**
   * 子プロセスへ渡す環境変数。**既定は空**。
   * 親の環境をそのまま渡すと、API キーごと外部のサーバへ渡ることになる。
   */
  readonly env?: Readonly<Record<string, string>>;
}

/**
 * ローカルで起動した MCP サーバと、改行区切り JSON で話す。
 *
 * 環境変数を既定で渡さないのが要点。`process.env` を素通しすると、
 * plugin が持ち込んだ実行ファイルに、こちらの資格情報が全部渡る。
 */
export function stdioChannel(options: StdioOptions): McpTransportChannel {
  const timeoutMs = options.timeoutMs ?? MCP_TIMEOUT_MS;
  let child: ChildProcessWithoutNullStreams | null = null;
  let buffer = '';
  const waiting = new Map<string | number, (value: unknown) => void>();
  let failure: Error | null = null;

  const ensure = (): ChildProcessWithoutNullStreams => {
    if (child) return child;
    child = spawn(options.command, [...(options.args ?? [])], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...(options.env ?? {}) },
    });

    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      buffer += chunk;
      if (buffer.length > MAX_MESSAGE_BYTES) {
        failure = new Error('mcp server sent more than the message limit');
        buffer = '';
        return;
      }
      let newline = buffer.indexOf('\n');
      while (newline >= 0) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (line.length > 0) {
          try {
            const message = JSON.parse(line) as { id?: string | number };
            const resolve = message.id === undefined ? undefined : waiting.get(message.id);
            // 待っていない id は捨てる。通知は使わない。
            if (resolve) {
              waiting.delete(message.id!);
              resolve(message);
            }
          } catch {
            // 壊れた行は捨てる。切断すると、次の往復まで巻き添えになる。
          }
        }
        newline = buffer.indexOf('\n');
      }
    });

    child.on('error', (error) => {
      failure = error;
    });
    child.on('exit', (code) => {
      failure = new Error(`mcp server exited with ${String(code)}`);
      for (const [, resolve] of waiting) resolve({ __exited: true });
      waiting.clear();
    });
    return child;
  };

  return {
    async send(request) {
      if (failure) throw new AstraError('host.not_connected', failure.message);
      const process = ensure();
      const id = request['id'] as string | number;

      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          waiting.delete(id);
          reject(new AstraError('host.timeout', `mcp server did not answer in ${timeoutMs}ms`));
        }, timeoutMs);

        waiting.set(id, (value) => {
          clearTimeout(timer);
          if ((value as { __exited?: boolean }).__exited) {
            reject(new AstraError('host.not_connected', failure?.message ?? 'mcp server exited'));
            return;
          }
          resolve(value);
        });
        process.stdin.write(`${JSON.stringify(request)}\n`);
      });
    },

    async close() {
      for (const [, resolve] of waiting) resolve({ __exited: true });
      waiting.clear();
      child?.kill();
      child = null;
    },
  };
}

export interface HttpOptions {
  readonly url: string;
  readonly timeoutMs?: number;
  readonly headers?: Readonly<Record<string, string>>;
  readonly fetch?: (url: string, init: RequestInit) => Promise<Response>;
}

/** cloud-MCP。1 リクエスト = 1 往復。 */
export function httpChannel(options: HttpOptions): McpTransportChannel {
  const timeoutMs = options.timeoutMs ?? MCP_TIMEOUT_MS;
  const doFetch = options.fetch ?? ((url, init) => fetch(url, init));

  return {
    async send(request) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await doFetch(options.url, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            accept: 'application/json',
            ...(options.headers ?? {}),
          },
          body: JSON.stringify(request),
          signal: controller.signal,
        });
        if (!response.ok) {
          throw new AstraError('host.capability_denied', `mcp server responded ${response.status}`);
        }
        return await response.json();
      } catch (error) {
        if (error instanceof AstraError) throw error;
        if (controller.signal.aborted) {
          throw new AstraError('host.timeout', `mcp server did not answer in ${timeoutMs}ms`);
        }
        throw new AstraError('host.not_connected', String(error));
      } finally {
        clearTimeout(timer);
      }
    },

    async close() {
      /* HTTP は繋ぎっぱなしにしない */
    },
  };
}
