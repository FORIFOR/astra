/**
 * 規制区分の plugin を、実装していないゲートの上で動かさない。正本 §22。
 */
import { describe, expect, it } from 'vitest';
import { assertRegulatedPluginHasRules, isStrictProfile } from '../src/compliance.js';

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

describe('assertRegulatedPluginHasRules', () => {
  it('refuses a regulated plugin that ships no enforceable rule', () => {
    // manifest の不変条件は policies を要求するが、中身が空でも通ってしまう
    expect(() => assertRegulatedPluginHasRules('CARE', 0, 'com.x.care')).toThrow(
      /must say what it will not do/,
    );
  });

  it('says which plugin and which profile, so it can be acted on', () => {
    expect.assertions(2);
    try {
      assertRegulatedPluginHasRules('FINANCIAL', 0, 'com.x.trade');
    } catch (error) {
      expect((error as Error).message).toContain('com.x.trade');
      expect((error as Error).message).toContain('FINANCIAL');
    }
  });

  it('lets a regulated plugin through once it has rules', () => {
    expect(() => assertRegulatedPluginHasRules('CARE', 2, 'com.x.care')).not.toThrow();
  });

  it('leaves ordinary plugins alone', () => {
    for (const p of ['GENERAL', 'ENTERPRISE'] as const) {
      expect(() => assertRegulatedPluginHasRules(p, 0, 'com.x.y')).not.toThrow();
    }
  });
});
