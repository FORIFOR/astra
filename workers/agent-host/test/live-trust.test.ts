import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TokenSet } from '@astra/oauth';
import { assertLiveScopes, liveTokens, LIVE_SCOPES } from '../src/live-oauth.js';
import { checkReceipt, type ObservedMail } from '../src/live-receipt.js';
const read = LIVE_SCOPES.google.read;
const tokens = (grantedScopes: readonly string[]): TokenSet => ({
  accessToken: 'test-only',
  refreshToken: null,
  expiresAt: null,
  tokenType: 'Bearer',
  idToken: null,
  grantedScopes,
});
describe('live grants', () => {
  it('rejects read/write mailbox authority on a send-only grant', () =>
    expect(() =>
      assertLiveScopes(
        tokens(['Mail.Send', 'User.Read', 'Mail.ReadWrite']),
        LIVE_SCOPES.microsoft.write,
        'write',
      ),
    ).toThrow('non-write'));

  it('accepts provider-attested read scopes', () =>
    expect(() => assertLiveScopes(tokens(read), read, 'read')).not.toThrow());
  it('does not manufacture missing scope attestations', () =>
    expect(() => assertLiveScopes(tokens([]), read, 'read')).toThrow());
  it('rejects a broad token disguised as a read connection', () =>
    expect(() =>
      assertLiveScopes(tokens([...read, ...LIVE_SCOPES.google.write]), read, 'read'),
    ).toThrow('non-read'));
  it('allows the Microsoft fixture seed grant to carry its cleanup scopes', () =>
    expect(() =>
      assertLiveScopes(
        tokens([
          'Mail.ReadWrite',
          'Mail.Read',
          'Mail.Send',
          'Calendars.Read',
          'Calendars.ReadWrite',
          'User.Read',
        ]),
        ['Mail.ReadWrite', 'Calendars.ReadWrite', 'User.Read'],
        'seed',
      ),
    ).not.toThrow());
  it('requires send permission before storing a write grant', () =>
    expect(() => assertLiveScopes(tokens(read), LIVE_SCOPES.google.write, 'write')).toThrow());
});
const expected = {
  subject: 'Re: ACME',
  body: '回答\n[live NONCE]',
  to: 'fixture@example.invalid',
  thread: 'original-thread',
  nonce: 'NONCE',
};
const sent: ObservedMail = {
  id: 'sent-1',
  subject: expected.subject,
  body: expected.body,
  to: [expected.to],
  thread: expected.thread,
  sent: true,
  received: false,
};
const received: ObservedMail = { ...sent, id: 'received-1', sent: false, received: true };
describe('actual reply receipt', () => {
  it('requires both one sent copy and one incoming copy', () => {
    expect(checkReceipt([sent, received], expected)).toBe(true);
    expect(checkReceipt([sent], expected)).toBe(false);
  });
  it('accepts Gmail self-delivery represented by one ID with both labels', () =>
    expect(checkReceipt([{ ...sent, received: true }], expected)).toBe(true));
  it.each([
    { body: 'different body of same length' },
    { to: ['other@example.invalid'] },
    { thread: 'wrong-thread' },
    { subject: 'Re: other subject' },
  ])('rejects mismatched received content %s', (change) =>
    expect(checkReceipt([sent, { ...received, ...change }], expected)).toBe(false),
  );
  it('rejects duplicate sends and deliveries', () => {
    expect(checkReceipt([sent, received, { ...sent, id: 'sent-2' }], expected)).toBe(false);
    expect(checkReceipt([sent, received, { ...received, id: 'received-2' }], expected)).toBe(false);
  });
  it('cannot claim thread preservation when the original thread is unknown', () =>
    expect(checkReceipt([sent, received], { ...expected, thread: '' })).toBe(false));
});

describe('Microsoft live-client provisioning', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });
  it.each(['read', 'write'] as const)(
    'refuses a legacy shared %s client before contacting Microsoft',
    async (grant) => {
      for (const prefix of ['MS', 'MICROSOFT']) {
        vi.stubEnv(`ASTRA_TEST_${prefix}_CLIENT_ID`, 'shared');
        vi.stubEnv(`ASTRA_TEST_${prefix}_READ_CLIENT_ID`, 'shared');
        vi.stubEnv(`ASTRA_TEST_${prefix}_WRITE_CLIENT_ID`, 'shared');
      }
      const request = vi.fn();
      vi.stubGlobal('fetch', request);
      await expect(liveTokens('microsoft', LIVE_SCOPES.microsoft[grant], grant)).rejects.toThrow(
        'distinct OAuth clients',
      );
      expect(request).not.toHaveBeenCalled();
    },
  );
});
