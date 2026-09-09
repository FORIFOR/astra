import { describe, expect, it } from 'vitest';
import { extractDeadline } from '../src/work/deadline.js';

const now = new Date('2026-09-07T00:00:00Z');

describe('deadline calendar timezone', () => {
  it('uses the Japanese business timezone independently of the server timezone', () => {
    expect(extractDeadline('9/8 まで', now)?.at).toBe('2026-09-08T09:00:00.000Z');
    expect(extractDeadline('明日まで', now)?.at).toBe('2026-09-08T09:00:00.000Z');
  });
  it('uses the business calendar date across a UTC year boundary', () => {
    expect(extractDeadline('今日中', new Date('2026-12-31T18:00:00Z'))?.at).toBe(
      '2027-01-01T09:00:00.000Z',
    );
  });
  it('preserves an explicit offset including fractional seconds', () => {
    expect(extractDeadline('2026-09-08T18:00:00.125Z', now)?.at).toBe('2026-09-08T18:00:00.125Z');
    expect(extractDeadline('2026-09-08T18:00-04:00', now)?.at).toBe('2026-09-08T22:00:00.000Z');
  });
  it('supports an explicit business timezone across daylight saving changes', () => {
    expect(
      extractDeadline('tomorrow', new Date('2026-03-07T17:00:00Z'), 'America/New_York')?.at,
    ).toBe('2026-03-08T22:00:00.000Z');
    expect(extractDeadline('EOD', now, 'UTC')?.at).toBe('2026-09-07T18:00:00.000Z');
  });
  it.each(['2026-03-08T02:30', '2026-11-01T01:30'])(
    'does not guess a missing or ambiguous wall time: %s',
    (text) => {
      expect(extractDeadline(text, now, 'America/New_York')).toBeNull();
    },
  );
  it.each(['2026-02-31', '4/31 まで', '2026-09-08T25:00'])(
    'rejects invalid calendar values: %s',
    (text) => {
      expect(extractDeadline(text, now)).toBeNull();
    },
  );
  it('does not fall back to the host timezone for invalid configuration', () => {
    expect(extractDeadline('tomorrow', now, 'invalid/timezone')).toBeNull();
  });
  it('rejects an out-of-range relative date without throwing', () => {
    expect(extractDeadline('within 999999999999999999999 days', now)).toBeNull();
  });
  it('matches day after tomorrow before its tomorrow suffix', () => {
    expect(extractDeadline('day after tomorrow', now)?.at).toBe('2026-09-09T09:00:00.000Z');
  });
});
