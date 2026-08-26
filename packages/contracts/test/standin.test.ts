/**
 * 代役を名乗らせる。正本 §21・§25。
 *
 * **「まだ繋いでいない」を人の記憶に置かない。**
 */
import { describe, expect, it } from 'vitest';
import {
  EXTERNAL_CAPABILITIES,
  NOT_IMPLEMENTED,
  assertNoStandIns,
  buildCapabilityReport,
  missingFromReport,
  remainingStandIns,
  type CapabilityInput,
  type ExternalCapability,
} from '../src/index.js';

const real = (name: string): CapabilityInput => ({
  implementation: name,
  isStandIn: false,
  configureWith: null,
});
const standIn = (name: string, how: string): CapabilityInput => ({
  implementation: name,
  isStandIn: true,
  configureWith: how,
});

const allReal = () =>
  buildCapabilityReport(
    Object.fromEntries(EXTERNAL_CAPABILITIES.map((c) => [c, real(c)])) as Record<
      ExternalCapability,
      CapabilityInput
    >,
  );

describe('the list of what comes from outside', () => {
  it('names every capability the product needs', () => {
    // 実装が追い付いていない行を、ここから消して辻褄を合わせない
    expect([...EXTERNAL_CAPABILITIES]).toEqual([
      'search',
      'language_model',
      'speech_to_text',
      'translation',
      'image_generation',
      'video_generation',
      'oauth_providers',
    ]);
  });

  it('cannot be built while leaving one out', () => {
    const report = allReal();
    expect(missingFromReport(report)).toEqual([]);
    expect(report.items).toHaveLength(EXTERNAL_CAPABILITIES.length);
  });

  it('notices when a report is short', () => {
    // 列挙から漏れたものは、代役かどうかも分からない
    expect(missingFromReport({ items: [] })).toEqual([...EXTERNAL_CAPABILITIES]);
  });
});

describe('what happens when something is a stand-in', () => {
  const withOne = () => {
    const inputs = Object.fromEntries(EXTERNAL_CAPABILITIES.map((c) => [c, real(c)])) as Record<
      ExternalCapability,
      CapabilityInput
    >;
    inputs.search = standIn('static', 'ASTRA_SEARCH_PROVIDER');
    return buildCapabilityReport(inputs);
  };

  it('says nothing when everything is real', () => {
    expect(assertNoStandIns(allReal(), 'production').warn).toBeNull();
    expect(remainingStandIns(allReal())).toEqual([]);
  });

  it('warns outside production', () => {
    const { warn, remaining } = assertNoStandIns(withOne(), 'development');
    expect(warn).toContain('検索');
    expect(warn).toContain('static');
    expect(remaining).toHaveLength(1);
  });

  it('refuses to start production, and says what to configure', () => {
    expect(() => assertNoStandIns(withOne(), 'production')).toThrow(/ASTRA_SEARCH_PROVIDER/);
  });
});

describe('what is not implemented at all', () => {
  it('counts as a stand-in, not as real', () => {
    const missing = NOT_IMPLEMENTED('まだ実装がありません');
    // 無いものを「本物」にしない
    expect(missing.isStandIn).toBe(true);
    expect(missing.implementation).toBe('none');
  });

  it('stops production the same way a stand-in does', () => {
    const inputs = Object.fromEntries(EXTERNAL_CAPABILITIES.map((c) => [c, real(c)])) as Record<
      ExternalCapability,
      CapabilityInput
    >;
    inputs.video_generation = NOT_IMPLEMENTED('動画の生成はまだありません');
    expect(() => assertNoStandIns(buildCapabilityReport(inputs), 'production')).toThrow(/動画/);
  });
});
