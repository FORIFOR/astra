/**
 * 規制区分の plugin を、実装していないゲートの上で動かさない。正本 §22。
 */
import { describe, expect, it } from 'vitest';
import { assertPolicyEnforcementAvailable, isStrictProfile } from '../src/compliance.js';

describe('isStrictProfile', () => {
  it('names the profiles that need a compliance gate', () => {
    for (const p of ['REGULATED_HEALTH', 'CARE', 'FINANCIAL'] as const) {
      expect(isStrictProfile(p), p).toBe(true);
    }
    for (const p of ['GENERAL', 'ENTERPRISE'] as const) {
      expect(isStrictProfile(p), p).toBe(false);
    }
  });
});

describe('assertPolicyEnforcementAvailable', () => {
  it('refuses a regulated plugin in production while the rules are inert', () => {
    // 守っているつもりで守っていない状態が、一番まずい
    expect(() => assertPolicyEnforcementAvailable('CARE', 'production', 'com.x.care')).toThrow(
      /not enforced yet/,
    );
  });

  it('says which plugin and which profile, so it can be acted on', () => {
    expect.assertions(2);
    try {
      assertPolicyEnforcementAvailable('FINANCIAL', 'production', 'com.x.trade');
    } catch (error) {
      expect((error as Error).message).toContain('com.x.trade');
      expect((error as Error).message).toContain('FINANCIAL');
    }
  });

  it('does not get in the way of development', () => {
    expect(() =>
      assertPolicyEnforcementAvailable('CARE', 'development', 'com.x.care'),
    ).not.toThrow();
  });

  it('leaves ordinary plugins alone, even in production', () => {
    for (const p of ['GENERAL', 'ENTERPRISE'] as const) {
      expect(() => assertPolicyEnforcementAvailable(p, 'production', 'com.x.y')).not.toThrow();
    }
  });
});
