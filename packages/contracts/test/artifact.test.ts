import { describe, expect, it } from 'vitest';
import { MAX_DIRECT_UPLOAD_BYTES, objectKeyFor, safeFileName } from '../src/artifact.js';
import { PageQuery } from '../src/primitives.js';
import { uuidv7 } from '../src/uuid.js';

describe('object key', () => {
  it('puts the tenant first so bucket-level mistakes do not cross tenants', () => {
    const tenant = uuidv7();
    const artifact = uuidv7();
    expect(objectKeyFor(tenant, artifact, 1, 'report.md')).toBe(
      `t/${tenant}/a/${artifact}/v/1/report.md`,
    );
  });

  it('sanitizes file names', () => {
    expect(safeFileName('会議 議事録.md')).not.toMatch(/[^\x20-\x7E]/);
    // 非 ASCII の題名でも拡張子を落とさない
    expect(safeFileName('会議 議事録.md')).toBe('artifact.md');
    expect(safeFileName('Q3 Sales Report.pdf')).toBe('Q3_Sales_Report.pdf');
    expect(safeFileName('a/b\\c:d*e?f.txt')).toBe('a_b_c_d_e_f.txt');
    expect(safeFileName('../../etc/passwd')).not.toContain('..');
    expect(safeFileName('')).toBe('artifact');
    expect(safeFileName('x'.repeat(500)).length).toBeLessThanOrEqual(128);
  });

  it('keeps the direct upload limit at 25MB (spec §8.3)', () => {
    expect(MAX_DIRECT_UPLOAD_BYTES).toBe(25 * 1024 * 1024);
  });
});

describe('PageQuery', () => {
  it('accepts the strings a query string actually delivers', () => {
    // ?limit=2 は文字列で届く。ここを coerce しないと全ページング API が 400 になる
    expect(PageQuery.parse({ limit: '2' })).toMatchObject({ limit: 2 });
    expect(PageQuery.parse({}).limit).toBe(20);
  });

  it('still refuses values outside the allowed range', () => {
    expect(PageQuery.safeParse({ limit: '0' }).success).toBe(false);
    expect(PageQuery.safeParse({ limit: '101' }).success).toBe(false);
    expect(PageQuery.safeParse({ limit: 'abc' }).success).toBe(false);
    expect(PageQuery.safeParse({ limit: '1.5' }).success).toBe(false);
  });

  it('requires the cursor to be a uuid', () => {
    expect(PageQuery.safeParse({ cursor: 'nope' }).success).toBe(false);
  });
});
