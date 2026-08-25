import { describe, expect, it } from 'vitest';
import { computeAuditHash, verifyAuditChain, type AuditHashInput } from '../src/audit.js';

const row = (
  seq: number,
  prev: string | null,
  over: Partial<AuditHashInput> = {},
): AuditHashInput => ({
  tenant_id: '018f0000-0000-7000-8000-00000000000a',
  seq,
  actor_type: 'user',
  actor_id: 'u1',
  action: 'task.created',
  task_id: null,
  tool_id: null,
  external_effect: false,
  payload: { n: seq },
  created_at: `2026-08-26T00:00:0${seq}.000Z`,
  prev_hash: prev,
  ...over,
});

async function chain(count: number): Promise<(AuditHashInput & { hash: string })[]> {
  const out: (AuditHashInput & { hash: string })[] = [];
  let prev: string | null = null;
  for (let i = 1; i <= count; i += 1) {
    const r = row(i, prev);
    const hash = await computeAuditHash(r);
    out.push({ ...r, hash });
    prev = hash;
  }
  return out;
}

describe('computeAuditHash', () => {
  it('is stable regardless of property order', async () => {
    const a = await computeAuditHash(row(1, null));
    const reordered = { ...row(1, null) };
    const b = await computeAuditHash(
      Object.fromEntries(Object.entries(reordered).reverse()) as unknown as AuditHashInput,
    );
    expect(a).toBe(b);
  });

  it('ignores properties that are not part of the hashed row', async () => {
    // 行をそのまま（hash 付きで）渡しても結果が変わらないこと
    const r = row(1, null);
    const withExtra = { ...r, hash: 'f'.repeat(64), extra: 'noise' } as AuditHashInput;
    expect(await computeAuditHash(withExtra)).toBe(await computeAuditHash(r));
  });

  it('changes when any hashed field changes', async () => {
    const base = await computeAuditHash(row(1, null));
    expect(await computeAuditHash(row(1, null, { action: 'task.cancelled' }))).not.toBe(base);
    expect(await computeAuditHash(row(1, null, { external_effect: true }))).not.toBe(base);
    expect(await computeAuditHash(row(1, null, { payload: { n: 99 } }))).not.toBe(base);
    expect(await computeAuditHash(row(1, null, { actor_id: 'u2' }))).not.toBe(base);
  });
});

describe('verifyAuditChain', () => {
  it('accepts an empty chain', async () => {
    expect(await verifyAuditChain([])).toEqual([]);
  });

  it('accepts an intact chain', async () => {
    expect(await verifyAuditChain(await chain(5))).toEqual([]);
  });

  it('pinpoints a tampered row without flagging the rest of the chain', async () => {
    const rows = await chain(4);
    // 監査ログの中身だけ書き換える（DB ではトリガが拒否するが、
    // バックアップ改竄やダンプ差し替えを想定した検証）
    rows[1] = { ...rows[1]!, action: 'plugin.install' };
    const problems = await verifyAuditChain(rows);
    // 連鎖リンクは保存済み hash を辿るので、壊れているのは改竄された行だけ。
    // 「どの行が書き換わったか」が一意に分かる方が事故調査に有用。
    expect(problems).toEqual([{ kind: 'hash_mismatch', seq: 2 }]);
  });

  it('flags every row whose hash was recomputed inconsistently', async () => {
    const rows = await chain(3);
    // 改竄者が hash も付け替えたが、後続の prev_hash を直し忘れた場合
    const tampered: AuditHashInput = { ...rows[1]!, action: 'plugin.install' };
    rows[1] = { ...tampered, hash: await computeAuditHash(tampered) };
    const problems = await verifyAuditChain(rows);
    expect(problems).toEqual([{ kind: 'broken_link', seq: 3 }]);
  });

  it('detects a removed row as a sequence gap', async () => {
    const rows = await chain(4);
    rows.splice(1, 1);
    const problems = await verifyAuditChain(rows);
    expect(problems).toContainEqual({ kind: 'sequence_gap', seq: 3, expected: 2 });
    expect(problems.some((p) => p.kind === 'broken_link')).toBe(true);
  });

  it('detects a rewritten prev_hash', async () => {
    const rows = await chain(3);
    rows[2] = { ...rows[2]!, prev_hash: 'f'.repeat(64) };
    const problems = await verifyAuditChain(rows);
    expect(problems).toContainEqual({ kind: 'broken_link', seq: 3 });
    expect(problems).toContainEqual({ kind: 'hash_mismatch', seq: 3 });
  });

  it('rejects a chain whose root carries a prev_hash', async () => {
    const r = row(1, 'a'.repeat(64));
    const problems = await verifyAuditChain([{ ...r, hash: await computeAuditHash(r) }]);
    expect(problems).toContainEqual({ kind: 'broken_link', seq: 1 });
  });
});
