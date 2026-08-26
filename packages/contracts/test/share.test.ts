import { describe, expect, it } from 'vitest';
import {
  CreateShareRequest,
  MAX_SHARE_TTL_SECONDS,
  SHARE_EXPIRY_PRESETS,
  SHARE_UNLOCK_RATE_LIMIT,
  SHARE_VIEW_TOKEN_TTL_SECONDS,
  SharedArtifactView,
  isAllowlisted,
  shareLinkFor,
  tokenFromShareLink,
  ttlSecondsOf,
} from '../src/share.js';

describe('share expiry', () => {
  it('refuses a share with no expiry at all', () => {
    // 無期限の共有を作らせない
    expect(CreateShareRequest.safeParse({}).success).toBe(false);
  });

  it('accepts either a preset or an explicit number of seconds', () => {
    expect(ttlSecondsOf(CreateShareRequest.parse({ expires_in: '7d' }))).toBe(
      SHARE_EXPIRY_PRESETS['7d'],
    );
    expect(ttlSecondsOf(CreateShareRequest.parse({ expires_in_seconds: 90 }))).toBe(90);
  });

  it('caps how far into the future a share can live', () => {
    expect(
      CreateShareRequest.safeParse({ expires_in_seconds: MAX_SHARE_TTL_SECONDS + 1 }).success,
    ).toBe(false);
  });

  it('defaults to the closed side', () => {
    const parsed = CreateShareRequest.parse({ expires_in: '1h' });
    expect(parsed.allow_download).toBe(false);
    expect(parsed.one_time).toBe(false);
    expect(parsed.watermark).toBe(false);
    expect(parsed.allowlist).toEqual([]);
  });

  it('rejects a password too short to be worth asking for', () => {
    expect(CreateShareRequest.safeParse({ expires_in: '1h', password: 'ab' }).success).toBe(false);
  });
});

describe('allowlist', () => {
  it('lets everyone through when empty', () => {
    expect(isAllowlisted([], undefined)).toBe(true);
    expect(isAllowlisted([], 'a@example.com')).toBe(true);
  });

  it('requires an address once a list exists', () => {
    expect(isAllowlisted(['a@example.com'], undefined)).toBe(false);
  });

  it('matches a whole domain when the entry starts with @', () => {
    expect(isAllowlisted(['@partner.com'], 'someone@partner.com')).toBe(true);
    expect(isAllowlisted(['@partner.com'], 'someone@other.com')).toBe(false);
    // 部分一致で通さない
    expect(isAllowlisted(['@partner.com'], 'someone@evil-partner.com')).toBe(false);
  });

  it('matches an exact address regardless of case', () => {
    expect(isAllowlisted(['A@Example.com'], 'a@example.COM')).toBe(true);
    expect(isAllowlisted(['a@example.com'], 'b@example.com')).toBe(false);
  });
});

describe('share links', () => {
  it('puts the secret in the fragment so it never reaches the server', () => {
    const link = shareLinkFor('https://share.example.com/', 'v1.abc.def');
    expect(link).toBe('https://share.example.com/s#v1.abc.def');
    expect(link.split('#')[0]).not.toContain('def');
  });

  it('reads the token back from a fragment', () => {
    expect(tokenFromShareLink('#v1.abc.def')).toBe('v1.abc.def');
    expect(tokenFromShareLink('v1.abc.def')).toBe('v1.abc.def');
    expect(tokenFromShareLink('#')).toBeNull();
    expect(tokenFromShareLink('')).toBeNull();
  });
});

describe('what the viewer is told', () => {
  it('carries nothing that identifies the organisation', () => {
    const shape = Object.keys(SharedArtifactView.shape);
    expect(shape).not.toContain('tenant_id');
    expect(shape).not.toContain('owner_id');
    expect(shape).not.toContain('object_key');
    expect(shape).not.toContain('source_task_id');
  });
});

describe('limits', () => {
  it('keeps the view token short-lived and the unlock attempts few', () => {
    expect(SHARE_VIEW_TOKEN_TTL_SECONDS).toBeLessThanOrEqual(10 * 60);
    expect(SHARE_UNLOCK_RATE_LIMIT.limit).toBeLessThanOrEqual(20);
  });
});
