import { describe, expect, it } from 'vitest';
import { createUuidv7Generator, isUuidV7, uuidv7, uuidv7Timestamp } from '../src/uuid.js';

describe('uuidv7', () => {
  it('produces RFC 9562 v7 shape', () => {
    for (let i = 0; i < 100; i += 1) {
      const id = uuidv7();
      expect(isUuidV7(id)).toBe(true);
      expect(id[14]).toBe('7'); // version nibble
      expect('89ab').toContain(id[19]); // variant
    }
  });

  it('is lexicographically sortable in generation order', () => {
    const ids = Array.from({ length: 5000 }, () => uuidv7());
    const sorted = [...ids].sort();
    expect(sorted).toEqual(ids);
  });

  it('stays monotonic within a single millisecond', () => {
    const gen = createUuidv7Generator();
    const ids = Array.from({ length: 200 }, () => gen(1_700_000_000_000));
    expect(new Set(ids).size).toBe(ids.length);
    expect([...ids].sort()).toEqual(ids);
  });

  it('stays monotonic when the clock goes backwards', () => {
    const gen = createUuidv7Generator();
    const a = gen(1_800_000_000_000);
    const b = gen(1_700_000_000_000);
    expect(b > a).toBe(true);
  });

  it('exhausts the counter into the next millisecond without losing order', () => {
    const gen = createUuidv7Generator();
    const ids = Array.from({ length: 4100 }, () => gen(1_700_000_000_000));
    expect(new Set(ids).size).toBe(ids.length);
    expect([...ids].sort()).toEqual(ids);
    expect(uuidv7Timestamp(ids.at(-1)!)).toBe(1_700_000_000_001);
  });

  it('round-trips the embedded timestamp', () => {
    const gen = createUuidv7Generator();
    const now = 1_756_000_000_000;
    expect(uuidv7Timestamp(gen(now))).toBe(now);
  });

  it('never rewinds the shared generator below an already issued instant', () => {
    const ahead = uuidv7(Date.now() + 60_000);
    const behind = uuidv7(0);
    expect(behind > ahead).toBe(true);
  });

  it('rejects non-v7 uuids', () => {
    expect(isUuidV7('00000000-0000-4000-8000-000000000000')).toBe(false);
    expect(uuidv7Timestamp('not-a-uuid')).toBeNull();
  });
});
