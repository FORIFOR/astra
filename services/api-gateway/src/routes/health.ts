/**
 * liveness と readiness。実装仕様 §11。
 *
 * 分けるのは目的が違うから:
 *   /healthz  プロセスが生きているか。依存を見ない。落ちたら再起動される。
 *   /readyz   依存が揃っていてトラフィックを受けられるか。落ちても再起動しない。
 * ここを混ぜると、DB の一時的な不調でプロセスが再起動され続ける。
 */
import { pingDb, type DbHandle } from '@astra/db';
import type { App } from '../fastify.js';
import type { HealthResponse } from '@astra/contracts';
import type { Redis } from 'ioredis';

export interface HealthDeps {
  readonly db: DbHandle;
  readonly redis: Redis | null;
  readonly version: string;
  /** 依存確認のタイムアウト。probe が固まるとローリング更新が止まる。 */
  readonly checkTimeoutMs?: number;
}

async function withTimeout(work: Promise<unknown>, ms: number): Promise<boolean> {
  let timer: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      work,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('timeout')), ms);
      }),
    ]);
    return true;
  } catch {
    return false;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export function registerHealthRoutes(app: App, deps: HealthDeps): void {
  const timeout = deps.checkTimeoutMs ?? 2_000;

  app.get('/healthz', { config: { rateLimit: false } }, async () => {
    return { status: 'ok', version: deps.version } satisfies HealthResponse;
  });

  app.get('/readyz', { config: { rateLimit: false } }, async (_request, reply) => {
    const checks: Record<string, 'ok' | 'down'> = {};

    checks['database'] = (await withTimeout(pingDb(deps.db), timeout)) ? 'ok' : 'down';
    if (deps.redis) {
      checks['redis'] = (await withTimeout(deps.redis.ping(), timeout)) ? 'ok' : 'down';
    }
    // Temporal は P0-11 でここに足す

    const down = Object.values(checks).some((v) => v === 'down');
    const body: HealthResponse = {
      status: down ? 'down' : 'ok',
      version: deps.version,
      checks,
    };
    return reply.status(down ? 503 : 200).send(body);
  });
}
