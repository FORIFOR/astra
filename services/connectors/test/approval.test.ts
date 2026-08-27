import { describe, expect, it } from 'vitest';
import {
  ApprovalRequired,
  requireApproval,
  requireScope,
  type ApprovalProof,
} from '../src/approval.js';
import { ConnectorError } from '../src/http.js';
import { GMAIL_OPERATIONS } from '../src/gmail.js';
import { CALENDAR_OPERATIONS } from '../src/calendar.js';

const NOW = new Date('2026-08-27T00:00:00.000Z');

const approved: ApprovalProof = {
  approvalId: 'ap-1',
  operationId: 'gmail.send',
  decision: 'APPROVED',
  decidedBy: 'user-1',
  decidedAt: '2026-08-26T23:59:00.000Z',
  expiresAt: '2026-08-27T00:05:00.000Z',
};

describe('the approval gate', () => {
  it('lets a read through without any proof', () => {
    expect(() => requireApproval(GMAIL_OPERATIONS.get, undefined, NOW)).not.toThrow();
  });

  it('lets a draft through without any proof, because it is not sent', () => {
    expect(GMAIL_OPERATIONS.draft.requiresApproval).toBe(false);
    expect(() => requireApproval(GMAIL_OPERATIONS.draft, undefined, NOW)).not.toThrow();
  });

  it('stops a send that has no proof', () => {
    expect(() => requireApproval(GMAIL_OPERATIONS.send, undefined, NOW)).toThrow(ApprovalRequired);
  });

  it('stops a send whose proof approves a different operation', () => {
    expect(() =>
      requireApproval(GMAIL_OPERATIONS.send, { ...approved, operationId: 'gmail.draft' }, NOW),
    ).toThrow(ApprovalRequired);
  });

  it('stops a send that was rejected', () => {
    expect(() =>
      requireApproval(GMAIL_OPERATIONS.send, { ...approved, decision: 'REJECTED' }, NOW),
    ).toThrow(ApprovalRequired);
  });

  it('stops a send whose approval has expired', () => {
    const later = new Date('2026-08-27T00:06:00.000Z');
    expect(() => requireApproval(GMAIL_OPERATIONS.send, approved, later)).toThrow(ApprovalRequired);
  });

  it('stops a send that nobody decided', () => {
    expect(() =>
      requireApproval(GMAIL_OPERATIONS.send, { ...approved, decidedBy: '' }, NOW),
    ).toThrow(ApprovalRequired);
  });

  it('lets a send through when the proof matches and is still valid', () => {
    expect(() => requireApproval(GMAIL_OPERATIONS.send, approved, NOW)).not.toThrow();
  });

  it('requires approval for trashing, and for creating a calendar event', () => {
    expect(GMAIL_OPERATIONS.trash.requiresApproval).toBe(true);
    expect(CALENDAR_OPERATIONS.create.requiresApproval).toBe(true);
    expect(CALENDAR_OPERATIONS.list.requiresApproval).toBe(false);
  });

  it('gives reading, drafting, trashing and sending four different scopes', () => {
    const scopes = new Set([
      GMAIL_OPERATIONS.get.scope,
      GMAIL_OPERATIONS.draft.scope,
      GMAIL_OPERATIONS.trash.scope,
      GMAIL_OPERATIONS.send.scope,
    ]);
    expect(scopes.size).toBe(4);
  });

  it('refuses an operation whose scope was never granted', () => {
    expect(() => requireScope(GMAIL_OPERATIONS.send, ['email.read', 'email.draft'])).toThrow(
      ConnectorError,
    );
    try {
      requireScope(GMAIL_OPERATIONS.send, ['email.read']);
    } catch (error) {
      expect((error as ConnectorError).reason).toBe('insufficient_scope');
    }
  });
});
