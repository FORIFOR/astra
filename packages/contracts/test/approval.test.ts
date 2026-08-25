import { describe, expect, it } from 'vitest';
import {
  ACTION_RISKS,
  ActionReceipt,
  Approval,
  ApprovalDetail,
  riskRank,
} from '../src/approval.js';
import { uuidv7 } from '../src/uuid.js';

describe('action risk', () => {
  it('declares every level from the product spec §9.2', () => {
    expect([...ACTION_RISKS]).toEqual([
      'READ',
      'REVERSIBLE_WRITE',
      'EXTERNAL_COMMIT',
      'DESTRUCTIVE',
      'REGULATED',
      'FINANCIAL',
    ]);
  });

  it('orders risk by impact', () => {
    expect(riskRank('READ')).toBeLessThan(riskRank('EXTERNAL_COMMIT'));
    expect(riskRank('EXTERNAL_COMMIT')).toBeLessThan(riskRank('DESTRUCTIVE'));
  });
});

describe('approval card', () => {
  it('carries only user-facing fields (spec §9.3 hides tool ids and JSON)', () => {
    const shape = Object.keys(Approval.shape);
    expect(shape).not.toContain('tool_id');
    expect(shape).not.toContain('raw_input');
    expect(Object.keys(ApprovalDetail.shape)).toEqual(['label', 'value']);
  });

  it('validates a pending approval', () => {
    const now = new Date().toISOString();
    const r = Approval.safeParse({
      id: uuidv7(),
      tenant_id: uuidv7(),
      task_id: uuidv7(),
      risk: 'EXTERNAL_COMMIT',
      summary: '送信します',
      details: [{ label: 'To', value: 'a@example.com' }],
      editable_fields: ['subject'],
      status: 'PENDING',
      expires_at: now,
      decided_by: null,
      decided_at: null,
      created_at: now,
    });
    expect(r.success).toBe(true);
  });
});

describe('action receipt', () => {
  it('requires a sha256 input hash', () => {
    const base = {
      id: uuidv7(),
      tenant_id: uuidv7(),
      task_id: uuidv7(),
      tool_id: 'mail.send',
      actor: 'agent',
      result_ref: null,
      risk: 'EXTERNAL_COMMIT',
      approved_by: uuidv7(),
      reversible_until: null,
      executed_at: new Date().toISOString(),
    };
    expect(ActionReceipt.safeParse({ ...base, inputs_hash: 'a'.repeat(64) }).success).toBe(true);
    expect(ActionReceipt.safeParse({ ...base, inputs_hash: 'A'.repeat(64) }).success).toBe(false);
    expect(ActionReceipt.safeParse({ ...base, inputs_hash: 'abc' }).success).toBe(false);
  });
});
