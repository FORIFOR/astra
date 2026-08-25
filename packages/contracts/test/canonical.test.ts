import { describe, expect, it } from 'vitest';
import { canonicalJson, canonicalSha256, sha256Hex, toHex } from '../src/canonical.js';

describe('canonicalJson', () => {
  it('orders object keys deterministically', () => {
    expect(canonicalJson({ b: 1, a: 2, c: 3 })).toBe('{"a":2,"b":1,"c":3}');
    expect(canonicalJson({ c: 3, a: 2, b: 1 })).toBe(canonicalJson({ a: 2, b: 1, c: 3 }));
  });

  it('orders nested keys too', () => {
    expect(canonicalJson({ z: { y: 1, x: 2 }, a: [{ q: 1, p: 2 }] })).toBe(
      '{"a":[{"p":2,"q":1}],"z":{"x":2,"y":1}}',
    );
  });

  it('preserves array order', () => {
    expect(canonicalJson([3, 1, 2])).toBe('[3,1,2]');
  });

  it('emits no whitespace', () => {
    expect(canonicalJson({ a: 1, b: [1, 2] })).not.toMatch(/\s/);
  });

  it('drops undefined properties but nulls undefined array slots', () => {
    expect(canonicalJson({ a: 1, b: undefined })).toBe('{"a":1}');
    expect(canonicalJson([1, undefined, 2])).toBe('[1,null,2]');
  });

  it('rejects values that cannot round-trip', () => {
    expect(() => canonicalJson(Number.NaN)).toThrow(/non-finite/);
    expect(() => canonicalJson(Number.POSITIVE_INFINITY)).toThrow(/non-finite/);
    expect(() => canonicalJson(1n)).toThrow(/bigint/);
    expect(() => canonicalJson(undefined)).toThrow(/undefined/);
    expect(() => canonicalJson(() => 1)).toThrow(/function/);
  });

  it('rejects circular structures instead of hanging', () => {
    const a: Record<string, unknown> = {};
    a['self'] = a;
    expect(() => canonicalJson(a)).toThrow(/circular/);
  });

  it('reuses an object graph that appears twice without calling it circular', () => {
    const shared = { x: 1 };
    expect(canonicalJson({ a: shared, b: shared })).toBe('{"a":{"x":1},"b":{"x":1}}');
  });

  it('serializes dates as ISO strings', () => {
    expect(canonicalJson({ at: new Date('2026-08-26T00:00:00.000Z') })).toBe(
      '{"at":"2026-08-26T00:00:00.000Z"}',
    );
  });
});

describe('sha256Hex', () => {
  it('matches the known digest of the empty string', async () => {
    expect(await sha256Hex('')).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
  });

  it('matches the known digest of "abc"', async () => {
    expect(await sha256Hex('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });

  it('accepts bytes as well as strings', async () => {
    expect(await sha256Hex(new TextEncoder().encode('abc'))).toBe(await sha256Hex('abc'));
  });

  it('is stable across key order via canonicalSha256', async () => {
    expect(await canonicalSha256({ a: 1, b: 2 })).toBe(await canonicalSha256({ b: 2, a: 1 }));
  });

  it('changes when any byte changes', async () => {
    expect(await canonicalSha256({ a: 1 })).not.toBe(await canonicalSha256({ a: 2 }));
  });
});

describe('toHex', () => {
  it('renders lowercase, zero-padded bytes', () => {
    expect(toHex(new Uint8Array([0, 1, 15, 16, 255]))).toBe('00010f10ff');
  });
});
