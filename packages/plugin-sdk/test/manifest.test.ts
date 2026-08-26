/**
 * 同梱 manifest の適合性。実装仕様 §9.1、受け入れテスト AC-12 / AC-13。
 */
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  generatePublisherKeyPair,
  loadManifest,
  loadManifestFile,
  parseManifest,
  signManifest,
  signatureStateFor,
  signingPayload,
  verifyManifestSignature,
} from '../src/index.js';

const builtinDir = fileURLToPath(new URL('../../../plugins/builtin', import.meta.url));

async function builtinPaths(): Promise<string[]> {
  const entries = await readdir(builtinDir, { withFileTypes: true });
  return entries
    .filter((e) => e.isDirectory())
    .map((e) => path.join(builtinDir, e.name, 'plugin.yaml'))
    .sort();
}

describe('bundled manifests', () => {
  it('ships exactly the ones the spec lists', async () => {
    // 数を固定してあるのは、同梱を**意図せず**増やさないため。
    // 増やすときはここも直す（増やしたことが diff に残る）。
    const paths = await builtinPaths();
    expect(paths).toHaveLength(6);
  });

  it('every bundled manifest passes validation (AC-12)', async () => {
    for (const file of await builtinPaths()) {
      const loaded = await loadManifestFile(file);
      expect(loaded.manifest.id).toMatch(/^[a-z0-9]+(\.[a-z0-9-]+)+$/);
      expect(loaded.sha256).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it('marks bundled agents as trusted without a signature', async () => {
    const meeting = await loadManifestFile(path.join(builtinDir, 'meeting', 'plugin.yaml'));
    expect(meeting.manifest.builtin).toBe(true);
    expect(meeting.manifest.removable).toBe(false);
    expect(signatureStateFor(meeting.manifest, false)).toBe('BUILTIN_TRUSTED');
  });

  it('declares confirmation on every high-risk bundled tool', async () => {
    for (const file of await builtinPaths()) {
      const { manifest } = await loadManifestFile(file);
      for (const tool of manifest.tools) {
        if (['EXTERNAL_COMMIT', 'DESTRUCTIVE', 'REGULATED', 'FINANCIAL'].includes(tool.risk)) {
          expect(tool.requires_confirmation, `${manifest.id}/${tool.id}`).toBe(true);
        }
      }
    }
  });

  it('tells the user what data each bundled plugin reads', async () => {
    // 正本 §2.4: detail page で「data accessed」を必ず出せること
    for (const file of await builtinPaths()) {
      const { manifest } = await loadManifestFile(file);
      expect(manifest.data_accessed.length, manifest.id).toBeGreaterThan(0);
    }
  });

  it('produces a byte-identical canonical form regardless of key order', async () => {
    const file = path.join(builtinDir, 'gmail', 'plugin.yaml');
    const loaded = await loadManifestFile(file);
    const shuffled = Object.fromEntries(
      Object.entries(loaded.manifest as unknown as Record<string, unknown>).reverse(),
    );
    expect(signingPayload(shuffled as never)).toBe(loaded.canonical);
  });
});

describe('manifest rejection (AC-13)', () => {
  const base = {
    id: 'com.example.thing',
    name: 'Thing',
    version: '1.0.0',
    publisher: 'example',
    min_core_version: '0.1.0',
    category: 'connector',
    compliance_profile: 'GENERAL',
    execution_surfaces: ['cloud'],
    data_accessed: ['x'],
    tools: [{ id: 't', risk: 'READ' }],
  };

  it('refuses a high-risk tool without confirmation', () => {
    const bad = { ...base, tools: [{ id: 't', risk: 'DESTRUCTIVE' }] };
    expect(() => parseManifest(bad, 'test')).toThrow(/invalid manifest/);
  });

  it('reports which field failed, not just that it failed', () => {
    try {
      parseManifest({ ...base, tools: [{ id: 't', risk: 'DESTRUCTIVE' }] }, 'test');
      throw new Error('should have thrown');
    } catch (error) {
      const details = (error as { details?: { path: string }[] }).details ?? [];
      expect(details.some((d) => d.path.includes('requires_confirmation'))).toBe(true);
    }
  });

  it('refuses YAML that is not a manifest at all', async () => {
    await expect(loadManifest('just a string', 'test')).rejects.toThrow(/invalid manifest/);
    await expect(loadManifest(null, 'test')).rejects.toThrow(/invalid manifest/);
  });

  it('refuses a file that does not exist', async () => {
    await expect(loadManifestFile('/nowhere/plugin.yaml')).rejects.toThrow(/cannot read/);
  });
});

describe('signatures', () => {
  const manifest = {
    id: 'com.example.signed',
    name: 'Signed',
    version: '1.0.0',
    publisher: 'example',
    min_core_version: '0.1.0',
    category: 'connector' as const,
    compliance_profile: 'GENERAL' as const,
    execution_surfaces: ['cloud' as const],
    data_accessed: ['x'],
  };

  it('round-trips a real signature', async () => {
    const keys = generatePublisherKeyPair();
    const loaded = await loadManifest(manifest, 'test');
    const signature = signManifest(loaded.canonical, keys.privateKey);
    expect(verifyManifestSignature(loaded.canonical, signature, keys.publicKey)).toBe(true);
    expect(signatureStateFor(loaded.manifest, true)).toBe('VERIFIED');
  });

  it('fails when a single byte of the manifest changed', async () => {
    const keys = generatePublisherKeyPair();
    const loaded = await loadManifest(manifest, 'test');
    const signature = signManifest(loaded.canonical, keys.privateKey);
    const tampered = await loadManifest({ ...manifest, name: 'Evil' }, 'test');
    expect(verifyManifestSignature(tampered.canonical, signature, keys.publicKey)).toBe(false);
  });

  it('fails for a different publisher key', async () => {
    const mine = generatePublisherKeyPair();
    const theirs = generatePublisherKeyPair();
    const loaded = await loadManifest(manifest, 'test');
    const signature = signManifest(loaded.canonical, mine.privateKey);
    expect(verifyManifestSignature(loaded.canonical, signature, theirs.publicKey)).toBe(false);
  });

  it('returns false rather than throwing for malformed input', async () => {
    // 「形式エラーだから通す」という分岐を作らせないため、例外にしない
    const loaded = await loadManifest(manifest, 'test');
    expect(verifyManifestSignature(loaded.canonical, undefined, 'x')).toBe(false);
    expect(verifyManifestSignature(loaded.canonical, 'not-base64!!', 'also-bad')).toBe(false);
  });

  it('leaves an unsigned third-party manifest unsigned', async () => {
    const loaded = await loadManifest(manifest, 'test');
    expect(signatureStateFor(loaded.manifest, false)).toBe('UNSIGNED');
  });
});
