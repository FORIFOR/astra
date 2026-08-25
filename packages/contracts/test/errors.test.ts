import { describe, expect, it } from 'vitest';
import { ApiError, AstraError, ERROR_CODES, httpStatusFor } from '../src/errors.js';

describe('errors', () => {
  it('maps every declared code to an explicit status', () => {
    for (const code of ERROR_CODES) {
      const status = httpStatusFor(code);
      expect(status, `${code} has no status mapping`).toBeGreaterThanOrEqual(400);
      expect(status).toBeLessThan(600);
    }
  });

  it('hides cross-tenant resources behind 404 (deviation D-11)', () => {
    expect(httpStatusFor('task.not_found')).toBe(404);
    expect(httpStatusFor('artifact.not_found')).toBe(404);
  });

  it('serializes to the api error contract', () => {
    const err = new AstraError('task.unknown_kind', 'unknown kind "nope"', {
      details: { kind: 'nope' },
    });
    const body = err.toApiError('req-1');
    expect(ApiError.safeParse(body).success).toBe(true);
    expect(err.httpStatus).toBe(400);
    expect(body.error.request_id).toBe('req-1');
  });

  it('omits details when absent', () => {
    const body = new AstraError('common.internal', 'boom').toApiError('req-2');
    expect('details' in body.error).toBe(false);
  });

  it('defaults to non-retryable', () => {
    expect(new AstraError('common.internal', 'x').retryable).toBe(false);
    expect(new AstraError('common.unavailable', 'x', { retryable: true }).retryable).toBe(true);
  });
});
