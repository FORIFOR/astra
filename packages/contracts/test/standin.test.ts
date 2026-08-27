/**
 * 代役を名乗らせる。正本 §21・§25。
 *
 * **「まだ繋いでいない」を人の記憶に置かない。**
 */
import { describe, expect, it } from 'vitest';
import {
  EXTERNAL_CAPABILITIES,
  NOT_IMPLEMENTED,
  REQUIRED_CAPABILITIES,
  assertNoStandIns,
  buildCapabilityReport,
  isRequiredCapability,
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
      'text_to_speech',
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

  it('stops production when the missing one is required', () => {
    const inputs = Object.fromEntries(EXTERNAL_CAPABILITIES.map((c) => [c, real(c)])) as Record<
      ExternalCapability,
      CapabilityInput
    >;
    inputs.search = NOT_IMPLEMENTED('検索の提供者が決まっていません');
    expect(() => assertNoStandIns(buildCapabilityReport(inputs), 'production')).toThrow(/検索/);
  });

  it('still reports an optional one that does not exist, without blocking', () => {
    const inputs = Object.fromEntries(EXTERNAL_CAPABILITIES.map((c) => [c, real(c)])) as Record<
      ExternalCapability,
      CapabilityInput
    >;
    inputs.video_generation = NOT_IMPLEMENTED('動画の生成はまだありません');
    // 起動は止めないが、**無いことは言う**
    const { warn, remaining } = assertNoStandIns(buildCapabilityReport(inputs), 'production');
    expect(warn).toContain('動画');
    expect(remaining.map((r) => r.capability)).toEqual(['video_generation']);
  });
});

describe('required and optional', () => {
  const inputs = () =>
    Object.fromEntries(EXTERNAL_CAPABILITIES.map((c) => [c, real(c)])) as Record<
      ExternalCapability,
      CapabilityInput
    >;

  it('does not require what the product can live without', () => {
    // 読み上げが無くても Astra は使える（文字で読める）
    expect(isRequiredCapability('text_to_speech')).toBe(false);
    expect(isRequiredCapability('video_generation')).toBe(false);
    expect(isRequiredCapability('image_generation')).toBe(false);
  });

  it('requires what the product cannot work without', () => {
    for (const capability of REQUIRED_CAPABILITIES) {
      expect(isRequiredCapability(capability)).toBe(true);
    }
    expect(REQUIRED_CAPABILITIES).toContain('language_model');
    expect(REQUIRED_CAPABILITIES).toContain('speech_to_text');
  });

  it('lets production start with an optional stand-in, but still says so', () => {
    const withOptional = inputs();
    withOptional.text_to_speech = standIn('none', 'GOOGLE_CLOUD_PROJECT');
    const report = buildCapabilityReport(withOptional);

    // 1 つ欠けただけで本番が上がらないと、やがて必須から外され始める
    const { warn, remaining } = assertNoStandIns(report, 'production');
    expect(warn).toContain('読み上げ');
    expect(remaining).toHaveLength(1);
  });

  it('still refuses production when a required one is a stand-in', () => {
    const withRequired = inputs();
    withRequired.speech_to_text = standIn('scripted', 'GOOGLE_STT_RECOGNIZER');
    expect(() => assertNoStandIns(buildCapabilityReport(withRequired), 'production')).toThrow(
      /required capabilities/,
    );
  });
});

describe('which capabilities the core actually needs', () => {
  it('does not require what only optional plugins use', async () => {
    /*
     * `oauth_providers` を必須にしていた。正本 §29 の
     * 「at least Gmail/Calendar/Drive/Finder connectors」が根拠だったが、
     * §29 が言っているのは **product が備えていること**であって、
     * どの導入先でも設定済みであること、ではない。
     *
     * 製品自身の区分で、gmail / calendar / finder は任意の plugin。
     * 中核（general / meeting / research）は `connectors: []` で、
     * **OAuth を一つも使わない。**会議と調査にしか使わない人の
     * 起動を止める理由が無い。
     */
    const { readFile } = await import('node:fs/promises');
    const path = await import('node:path');
    const { fileURLToPath } = await import('node:url');
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

    for (const name of ['general', 'meeting', 'research']) {
      const manifest = await readFile(
        path.join(root, 'plugins/builtin', name, 'plugin.yaml'),
        'utf8',
      );
      // 中核は非削除。ここが変わったら、必須の線引きも見直す
      expect(manifest, name).toContain('removable: false');
      expect(manifest, `${name} が connector を持ち始めた`).toContain('connectors: []');
    }

    expect(REQUIRED_CAPABILITIES).not.toContain('oauth_providers');
  });

  it('still requires what the core cannot work without', () => {
    // 言語モデルが無ければ、中核の agent は一つも動かない
    for (const capability of [
      'search',
      'language_model',
      'speech_to_text',
      'translation',
    ] as const) {
      expect(REQUIRED_CAPABILITIES).toContain(capability);
    }
  });
});
