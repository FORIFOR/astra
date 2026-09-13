/** §21 Approval stale: 「内容が変更されたため、もう一度確認してください」 */
import { describe, expect, it } from 'vitest';
import { GenieError } from '@genie/contracts';
import { approvalFailureMessage } from '../src/work/approvalOutcome.js';

describe('approvalFailureMessage', () => {
  it('asks for a fresh look when the approval went stale', () => {
    expect(approvalFailureMessage(new GenieError('approval.expired', 'x'))).toBe(
      '内容が変更されたため、もう一度確認してください。',
    );
  });
  it('says when it was already decided', () => {
    expect(approvalFailureMessage(new GenieError('approval.already_decided', 'x'))).toContain(
      'すでに決まっています',
    );
  });
  it('never shows a raw error for the rest', () => {
    const text = approvalFailureMessage(new Error('ECONNRESET'));
    expect(text).not.toContain('ECONNRESET');
    expect(text).toContain('もう一度');
  });
});
