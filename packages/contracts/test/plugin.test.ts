import { describe, expect, it } from 'vitest';
import {
  MAX_CREDENTIAL_REF_LENGTH,
  PluginManifest,
  isCompatible,
  looksLikeCredential,
  looksLikeSecretName,
  looksLikeSecretValue,
} from '../src/plugin.js';

const gmail = {
  id: 'com.astra.gmail',
  name: 'Gmail',
  version: '0.1.0',
  publisher: 'astra',
  verified: true,
  min_core_version: '0.1.0',
  category: 'connector',
  compliance_profile: 'GENERAL',
  execution_surfaces: ['cloud'],
  permissions: ['email.read', 'email.send'],
  data_accessed: ['Gmail messages'],
  tools: [
    { id: 'mail.search', risk: 'READ' },
    { id: 'mail.send', risk: 'EXTERNAL_COMMIT', requires_confirmation: true },
  ],
};

const clone = (patch: Record<string, unknown>) => ({ ...structuredClone(gmail), ...patch });

describe('plugin manifest', () => {
  it('accepts a well-formed connector manifest', () => {
    const parsed = PluginManifest.safeParse(gmail);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.removable).toBe(true);
      expect(parsed.data.tools[0]?.surface).toBe('cloud');
    }
  });

  // 不変条件 1
  it('rejects a high-risk tool that does not require confirmation', () => {
    const bad = clone({ tools: [{ id: 'mail.send', risk: 'EXTERNAL_COMMIT' }] });
    const r = PluginManifest.safeParse(bad);
    expect(r.success).toBe(false);
    expect(JSON.stringify(r.error?.issues)).toContain('requires_confirmation');
  });

  it.each(['EXTERNAL_COMMIT', 'DESTRUCTIVE', 'REGULATED', 'FINANCIAL'])(
    'requires confirmation for risk %s',
    (risk) => {
      const bad = clone({ tools: [{ id: 't', risk }] });
      expect(PluginManifest.safeParse(bad).success).toBe(false);
    },
  );

  it.each(['READ', 'REVERSIBLE_WRITE'])('does not force confirmation for risk %s', (risk) => {
    const ok = clone({ tools: [{ id: 't', risk }] });
    expect(PluginManifest.safeParse(ok).success).toBe(true);
  });

  // 不変条件 2
  it('rejects a local tool when local is not an execution surface', () => {
    const bad = clone({
      execution_surfaces: ['cloud'],
      tools: [{ id: 'files.read', risk: 'READ', surface: 'local' }],
    });
    const r = PluginManifest.safeParse(bad);
    expect(r.success).toBe(false);
    expect(JSON.stringify(r.error?.issues)).toContain('execution_surfaces');
  });

  // 不変条件 3
  it('rejects an unverified builtin', () => {
    expect(PluginManifest.safeParse(clone({ builtin: true, verified: false })).success).toBe(false);
  });

  // 不変条件 4
  it.each(['REGULATED_HEALTH', 'CARE', 'FINANCIAL'])(
    'requires a policy document for %s',
    (profile) => {
      expect(PluginManifest.safeParse(clone({ compliance_profile: profile })).success).toBe(false);
      expect(
        PluginManifest.safeParse(clone({ compliance_profile: profile, policies: ['p.yaml'] }))
          .success,
      ).toBe(true);
    },
  );

  // 不変条件 5
  it('rejects an agent referencing an undeclared tool', () => {
    const bad = clone({ agents: [{ id: 'a', skill: 's.md', tools: ['mail.nope'] }] });
    expect(PluginManifest.safeParse(bad).success).toBe(false);
  });

  it('accepts an agent referencing a declared tool', () => {
    const ok = clone({ agents: [{ id: 'a', skill: 's.md', tools: ['mail.search'] }] });
    expect(PluginManifest.safeParse(ok).success).toBe(true);
  });

  it('rejects an unknown permission scope', () => {
    expect(PluginManifest.safeParse(clone({ permissions: ['universe.destroy'] })).success).toBe(
      false,
    );
  });

  it('rejects a non reverse-domain id and a non-semver version', () => {
    expect(PluginManifest.safeParse(clone({ id: 'gmail' })).success).toBe(false);
    expect(PluginManifest.safeParse(clone({ version: '1.0' })).success).toBe(false);
  });

  it('requires compliance_profile and at least one execution surface', () => {
    const { compliance_profile: _c, ...noProfile } = structuredClone(gmail);
    expect(PluginManifest.safeParse(noProfile).success).toBe(false);
    expect(PluginManifest.safeParse(clone({ execution_surfaces: [] })).success).toBe(false);
  });
});

describe('core compatibility', () => {
  it('compares against min_core_version', () => {
    expect(isCompatible('0.1.0', '0.1.0')).toBe(true);
    expect(isCompatible('0.1.0', '0.2.0')).toBe(true);
    expect(isCompatible('2.0.0', '1.9.9')).toBe(false);
  });
});

describe('telling a credential from ordinary text', () => {
  it('flags the shapes we know', () => {
    expect(looksLikeSecretValue('ya29.abc')).toBe(true);
    expect(looksLikeSecretValue('ghp_0123456789abcdefghij')).toBe(true);
    expect(looksLikeSecretValue('xoxb-1-2-3')).toBe(true);
    expect(looksLikeSecretValue('eyJhbGciOiJIUzI1NiJ9.payload')).toBe(true);
  });

  it('does not flag ordinary text for being long', () => {
    /*
     * 長さで弾いていた間、**長い本文のメールが資格情報扱いになっていた。**
     * 参照の検査（`looksLikeCredential`）は参照だけに使う。
     */
    const body = 'お世話になっております。'.repeat(50);
    expect(body.length).toBeGreaterThan(MAX_CREDENTIAL_REF_LENGTH);
    expect(looksLikeSecretValue(body)).toBe(false);
    expect(looksLikeCredential(body)).toBe(true);
  });

  it('flags a field whose name says it holds a secret', () => {
    for (const name of [
      'token',
      'access_token',
      'api_key',
      'apiKey',
      'password',
      'authorization',
    ]) {
      expect(looksLikeSecretName(name), name).toBe(true);
    }
  });

  it('does not flag ordinary field names', () => {
    for (const name of ['subject', 'body', 'to', 'message', 'tokenizer_note']) {
      expect(looksLikeSecretName(name), name).toBe(false);
    }
  });
});
