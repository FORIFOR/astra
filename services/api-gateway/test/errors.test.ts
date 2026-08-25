import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ApiError, AstraError } from '@astra/contracts';
import { toApiError } from '../src/errors.js';

describe('toApiError', () => {
  it('maps an AstraError to its code and status', () => {
    const { status, body } = toApiError(new AstraError('task.not_found', 'no such task'), 'req-1');
    expect(status).toBe(404);
    expect(body.error.code).toBe('task.not_found');
    expect(body.error.request_id).toBe('req-1');
    expect(ApiError.safeParse(body).success).toBe(true);
  });

  it('maps a ZodError to a validation failure listing paths but not values', () => {
    const parsed = z.object({ kind: z.string() }).safeParse({ kind: 42 });
    const { status, body } = toApiError(parsed.error, 'req-2');
    expect(status).toBe(400);
    expect(body.error.code).toBe('common.validation_failed');
    // 値そのものは返さない（PII が混ざり得る）
    expect(JSON.stringify(body)).not.toContain('42');
    expect(JSON.stringify(body)).toContain('kind');
  });

  it('never leaks an internal exception message', () => {
    const { status, body } = toApiError(
      new Error('connection string postgres://user:hunter2@db/astra failed'),
      'req-3',
    );
    expect(status).toBe(500);
    expect(body.error.code).toBe('common.internal');
    expect(body.error.message).toBe('internal error');
    expect(JSON.stringify(body)).not.toContain('hunter2');
  });

  it('respects a 4xx statusCode set by the framework', () => {
    const { status, body } = toApiError({ statusCode: 400, message: 'bad json' }, 'req-4');
    expect(status).toBe(400);
    expect(body.error.code).toBe('common.validation_failed');
    expect(body.error.message).not.toContain('bad json');
  });

  it('treats a 5xx statusCode as internal', () => {
    const { status, body } = toApiError({ statusCode: 502, message: 'upstream' }, 'req-5');
    expect(status).toBe(500);
    expect(body.error.code).toBe('common.internal');
  });
});
