import { describe, expect, it } from 'vitest';
import { planTask } from '../src/plan.js';

describe('Gmail reply plan', () => {
  it('passes the provider thread ID and the original message ID through the approval step', () => {
    const plan = planTask('mail.send', {
      source: 'gmail',
      to: ['self@example.invalid'],
      subject: 'Re: 見積',
      body: '確認しました',
      in_reply_to: 'message-1',
      thread_id: 'gmail:thread-1',
    });
    expect(plan.steps[0]).toMatchObject({
      toolId: 'mail.send',
      requiresConfirmation: true,
      args: { in_reply_to: 'message-1', thread_id: 'thread-1' },
    });
  });
});
