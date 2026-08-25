import { describe, expect, it } from 'vitest';
import {
  CreateTaskRequest,
  TASK_STATUSES,
  TASK_TRANSITIONS,
  TERMINAL_TASK_STATUSES,
  Task,
  canTransition,
  dockStateFor,
  isTerminal,
} from '../src/task.js';
import { uuidv7 } from '../src/uuid.js';

describe('task state machine', () => {
  it('has a transition entry for every status', () => {
    for (const s of TASK_STATUSES) expect(TASK_TRANSITIONS[s]).toBeDefined();
  });

  it('never leaves a terminal status', () => {
    for (const s of TERMINAL_TASK_STATUSES) {
      expect(TASK_TRANSITIONS[s]).toEqual([]);
      expect(isTerminal(s)).toBe(true);
      expect(canTransition(s, 'RUNNING')).toBe(false);
    }
  });

  it('allows same-status transitions so activity retries are no-ops', () => {
    for (const s of TASK_STATUSES) expect(canTransition(s, s)).toBe(true);
  });

  it('models the approval round trip', () => {
    expect(canTransition('RUNNING', 'WAITING_APPROVAL')).toBe(true);
    expect(canTransition('WAITING_APPROVAL', 'RUNNING')).toBe(true);
    expect(canTransition('WAITING_APPROVAL', 'CANCELLED')).toBe(true);
    expect(canTransition('WAITING_APPROVAL', 'COMPLETED')).toBe(false);
  });

  it('routes cancellation through CANCELLING', () => {
    expect(canTransition('RUNNING', 'CANCELLED')).toBe(false);
    expect(canTransition('RUNNING', 'CANCELLING')).toBe(true);
    expect(canTransition('CANCELLING', 'CANCELLED')).toBe(true);
  });
});

describe('task dock state mapping', () => {
  it('covers every server status', () => {
    for (const s of TASK_STATUSES) expect(dockStateFor(s)).toBeTruthy();
  });

  it('uses the progress phase to pick the running face', () => {
    expect(dockStateFor('RUNNING')).toBe('THINKING');
    expect(dockStateFor('RUNNING', 'researching')).toBe('RESEARCHING');
    expect(dockStateFor('RUNNING', 'acting')).toBe('ACTING');
    expect(dockStateFor('WAITING_APPROVAL')).toBe('WAITING_APPROVAL');
    expect(dockStateFor('COMPLETED')).toBe('RESULT');
    expect(dockStateFor('FAILED')).toBe('ERROR');
  });
});

describe('task schemas', () => {
  it('defaults input to an empty object', () => {
    const parsed = CreateTaskRequest.parse({ kind: 'echo' });
    expect(parsed.input).toEqual({});
  });

  it('rejects an empty kind', () => {
    expect(CreateTaskRequest.safeParse({ kind: '' }).success).toBe(false);
  });

  it('accepts a full task record', () => {
    const now = new Date().toISOString();
    const parsed = Task.safeParse({
      id: uuidv7(),
      tenant_id: uuidv7(),
      created_by: uuidv7(),
      conversation_id: null,
      kind: 'echo',
      title: 'hello',
      status: 'RUNNING',
      input: { message: 'hi' },
      result_artifact_id: null,
      error: null,
      created_at: now,
      started_at: now,
      completed_at: null,
      updated_at: now,
    });
    expect(parsed.success).toBe(true);
  });
});
