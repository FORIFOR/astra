import { describe, expect, it } from 'vitest';
import { uuidv7 } from '@astra/contracts';
import {
  hashPassword,
  hashShareSecret,
  mintShareToken,
  parseShareToken,
  requesterFingerprint,
  verifyPassword,
} from '../src/tokens.js';

describe('share tokens', () => {
  it('mints a token that carries the share id and a fresh secret', () => {
    const id = uuidv7();
    const a = mintShareToken(id);
    const b = mintShareToken(id);
    expect(parseShareToken(a.token)?.shareId).toBe(id);
    expect(a.secret).not.toBe(b.secret);
    // 32 バイトを base64url にすると 43 文字
    expect(a.secret).toHaveLength(43);
  });

  it('refuses anything that is not our token', () => {
    for (const bad of ['', 'abc', 'v2.a.b', 'v1.a', 'v1..b', 'v1.a.']) {
      expect(parseShareToken(bad), bad).toBeNull();
    }
  });

  it('binds the hash to the share id so a secret cannot be reused elsewhere', async () => {
    const secret = 'the-same-secret';
    expect(await hashShareSecret('share-a', secret)).not.toBe(
      await hashShareSecret('share-b', secret),
    );
  });
});

describe('passwords', () => {
  it('uses argon2id', async () => {
    // 利用者が選ぶ低エントロピーの秘密なので、ここは Argon2id でなければならない
    expect(await hashPassword('correct horse')).toMatch(/^\$argon2id\$/);
  });

  it('produces a different hash every time', async () => {
    expect(await hashPassword('same')).not.toBe(await hashPassword('same'));
  });

  it('verifies the right password and rejects the wrong one', async () => {
    const stored = await hashPassword('correct horse');
    expect(await verifyPassword(stored, 'correct horse')).toBe(true);
    expect(await verifyPassword(stored, 'Correct Horse')).toBe(false);
  });

  it('returns false rather than throwing on a broken hash', async () => {
    // 区別できると「形式エラーだから通す」分岐が生まれる
    expect(await verifyPassword('not-a-hash', 'anything')).toBe(false);
    expect(await verifyPassword('', '')).toBe(false);
  });
});

describe('requester fingerprint', () => {
  it('never contains the address itself', async () => {
    const hash = await requesterFingerprint('203.0.113.7', 'salt');
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).not.toContain('203');
  });

  it('changes with the salt so logs cannot be correlated across environments', async () => {
    expect(await requesterFingerprint('203.0.113.7', 'a')).not.toBe(
      await requesterFingerprint('203.0.113.7', 'b'),
    );
  });

  it('still records something when the address is unknown', async () => {
    expect(await requesterFingerprint(undefined, 'salt')).toMatch(/^[0-9a-f]{64}$/);
  });
});
