/**
 * 起動時の「何が本物で、何が代役か」。正本 §21・§25。
 *
 * ここで守りたいのは 1 つ:
 * **能力が増えたときに、数え漏らせないこと。**
 */
import { describe, expect, it } from 'vitest';
import {
  EXTERNAL_CAPABILITIES,
  assertNoStandIns,
  missingFromReport,
  remainingStandIns,
} from '@astra/contracts';
import { capabilityReport } from '../src/index.js';

const providers = (over: { search?: boolean; model?: boolean; stt?: boolean } = {}) => ({
  research: {
    search: { name: 'static', isStandIn: over.search ?? true },
    model: { name: 'deterministic', isStandIn: over.model ?? true },
  },
  meeting: {
    streaming: { isStandIn: over.stt ?? true },
    batch: { isStandIn: true },
    translation: { isStandIn: true },
    summarizer: { isStandIn: true },
  },
});

const report = (
  env: Record<string, string | undefined> = {},
  over: { search?: boolean; model?: boolean; stt?: boolean } = {},
) => capabilityReport({ ...providers(over), env } as never);

describe('the report', () => {
  it('answers for every capability', () => {
    // 列挙から漏れたものは、代役かどうかも分からない
    expect(missingFromReport(report())).toEqual([]);
    expect(report().items).toHaveLength(EXTERNAL_CAPABILITIES.length);
  });

  it('names what to configure for each stand-in', () => {
    for (const item of remainingStandIns(report())) {
      expect(
        item.configureWith,
        `${item.capability} says nothing about how to fix it`,
      ).toBeTruthy();
    }
  });

  it('counts the language model, which used to be missed', () => {
    // gateway は会議の提供者しか見ておらず、代役の言語モデルのまま起動できた
    const names = remainingStandIns(report()).map((r) => r.capability);
    expect(names).toContain('language_model');
    expect(names).toContain('search');
  });
});

describe('connectors', () => {
  it('is a stand-in while no provider is configured', () => {
    const oauth = report().items.find((i) => i.capability === 'oauth_providers')!;
    expect(oauth.isStandIn).toBe(true);
    expect(oauth.configureWith).toContain('ASTRA_OAUTH_GOOGLE_CLIENT_ID');
  });

  it('is real once every provider has a client id', () => {
    const configured = report({
      ASTRA_OAUTH_GOOGLE_CLIENT_ID: 'g',
      ASTRA_OAUTH_MICROSOFT_CLIENT_ID: 'm',
    });
    const oauth = configured.items.find((i) => i.capability === 'oauth_providers')!;
    expect(oauth.isStandIn).toBe(false);
    expect(oauth.implementation).not.toContain('unavailable');
  });

  it('is real with one provider, and still names the one that is not reachable', () => {
    // 全部揃うまで「接続できません」と答えるのは嘘。Google だけの構成は普通にある。
    const configured = report({ ASTRA_OAUTH_GOOGLE_CLIENT_ID: 'g' });
    const oauth = configured.items.find((i) => i.capability === 'oauth_providers')!;
    expect(oauth.isStandIn).toBe(false);
    expect(oauth.implementation).toContain('google');
    expect(oauth.implementation).toContain('unavailable: microsoft');
  });
});

describe('video', () => {
  it('says it does not exist, rather than pretending to be a stand-in that works', () => {
    const video = report().items.find((i) => i.capability === 'video_generation')!;
    expect(video.implementation).toBe('none');
    expect(video.isStandIn).toBe(true);
    expect(video.configureWith).toContain('§15.2');
  });
});

describe('production', () => {
  it('refuses to start while anything is a stand-in', () => {
    expect(() => assertNoStandIns(report(), 'production')).toThrow(/stand-ins/);
  });

  it('only warns elsewhere', () => {
    expect(assertNoStandIns(report(), 'development').warn).toContain('running with stand-ins');
  });
});
