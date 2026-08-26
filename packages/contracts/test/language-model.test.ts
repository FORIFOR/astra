/**
 * 言語モデルの持ち込み。正本 §21。
 *
 * **Astra は共通の API キーを持たない。**
 * 大事なのは、資格情報がどこに置かれるかの線引き。
 */
import { describe, expect, it } from 'vitest';
import {
  LANGUAGE_MODEL_KINDS,
  NO_MODEL_MESSAGE,
  SELECTION_ORDER,
  UNAVAILABLE_REASON,
  isAllowedCredentialLocation,
  selectLanguageModel,
  type LanguageModelKind,
  type LanguageModelOption,
} from '../src/index.js';

const option = (
  kind: LanguageModelKind,
  available: boolean,
  credential: LanguageModelOption['credential'],
): LanguageModelOption => ({
  kind,
  available,
  reason: available ? null : UNAVAILABLE_REASON[kind],
  credential,
  implementation: available ? kind : null,
});

describe('which model gets used', () => {
  it('prefers Claude Code over a key the user had to paste', () => {
    const chosen = selectLanguageModel([
      option('anthropic_api', true, 'keychain'),
      option('claude_code', true, 'claude_code'),
    ]);
    // 既に払っている利用権をそのまま使えるほうが手数が少ない
    expect(chosen?.kind).toBe('claude_code');
  });

  it('falls to the next one that is actually available', () => {
    const chosen = selectLanguageModel([
      option('claude_code', false, 'claude_code'),
      option('anthropic_api', false, 'keychain'),
      option('gemini_api', true, 'keychain'),
    ]);
    expect(chosen?.kind).toBe('gemini_api');
  });

  it('says nothing is available rather than degrading quietly', () => {
    const chosen = selectLanguageModel([
      option('claude_code', false, 'claude_code'),
      option('anthropic_api', false, 'keychain'),
    ]);
    expect(chosen).toBeNull();
  });

  it('covers every kind in the order', () => {
    expect([...SELECTION_ORDER].sort()).toEqual([...LANGUAGE_MODEL_KINDS].sort());
  });

  it('gives a reason for every kind that could be missing', () => {
    for (const kind of LANGUAGE_MODEL_KINDS) {
      expect(UNAVAILABLE_REASON[kind].length).toBeGreaterThan(0);
    }
    // 「あとで」で終わらせない
    expect(NO_MODEL_MESSAGE).toContain('登録');
  });
});

describe('where the credential may live', () => {
  it('never lets a key sit on the server', () => {
    for (const kind of LANGUAGE_MODEL_KINDS) {
      // サーバに置く選択肢そのものが無い
      expect(isAllowedCredentialLocation(kind, 'none') && kind !== 'local').toBe(false);
    }
  });

  it('keeps Claude Code credentials with Claude Code', () => {
    expect(isAllowedCredentialLocation('claude_code', 'claude_code')).toBe(true);
    // 抜き出して API へ流用しない。利用者が同意した経路から外れる。
    expect(isAllowedCredentialLocation('claude_code', 'keychain')).toBe(false);
  });

  it('puts a pasted key in the device store, nowhere else', () => {
    expect(isAllowedCredentialLocation('anthropic_api', 'keychain')).toBe(true);
    expect(isAllowedCredentialLocation('anthropic_api', 'claude_code')).toBe(false);
    expect(isAllowedCredentialLocation('anthropic_api', 'none')).toBe(false);
  });

  it('needs no credential for a model that runs here', () => {
    expect(isAllowedCredentialLocation('local', 'none')).toBe(true);
    expect(isAllowedCredentialLocation('local', 'keychain')).toBe(false);
  });
});
