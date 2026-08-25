import { Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { REDACTED_KEYS, createLogger, withCorrelation, type Logger } from '../src/logger.js';

function capture(): { logger: Logger; lines: () => unknown[] } {
  const chunks: string[] = [];
  const stream = new Writable({
    write(chunk, _enc, cb) {
      chunks.push(String(chunk));
      cb();
    },
  });
  // 本番と同じ createLogger を通す。テスト用に別の pino を組むと
  // redact 設定がずれても気づけない。
  const logger = createLogger({ service: 'test', level: 'info' }, stream);
  return { logger, lines: () => chunks.map((c) => JSON.parse(c) as unknown) };
}

describe('logger redaction', () => {
  it('hides credentials and PII at the top level', () => {
    const { logger, lines } = capture();
    logger.info({ email: 'a@example.com', access_token: 'secret', task_id: 't1' }, 'x');
    const [line] = lines() as Record<string, unknown>[];
    expect(line!['email']).toBe('[redacted]');
    expect(line!['access_token']).toBe('[redacted]');
    expect(line!['task_id']).toBe('t1');
  });

  it('hides them one and two levels deep as well', () => {
    const { logger, lines } = capture();
    logger.info({ user: { email: 'a@example.com' }, ctx: { a: { prompt: 'hi' } } }, 'x');
    const [line] = lines() as Record<string, Record<string, unknown>>[];
    expect((line!['user'] as Record<string, unknown>)['email']).toBe('[redacted]');
    expect(
      ((line!['ctx'] as Record<string, Record<string, unknown>>)['a'] as Record<string, unknown>)[
        'prompt'
      ],
    ).toBe('[redacted]');
  });

  it('covers the fields the spec calls out', () => {
    for (const key of ['email', 'refresh_token', 'prompt', 'transcript', 'content']) {
      expect(REDACTED_KEYS).toContain(key);
    }
  });
});

describe('withCorrelation', () => {
  it('attaches correlation ids to every line', () => {
    const { logger, lines } = capture();
    withCorrelation(logger, { request_id: 'r1', task_id: 't1' }).info('x');
    const [line] = lines() as Record<string, unknown>[];
    expect(line!['request_id']).toBe('r1');
    expect(line!['task_id']).toBe('t1');
  });
});
