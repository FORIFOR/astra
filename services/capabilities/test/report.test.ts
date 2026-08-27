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
  assertReadyForProduction,
  buildCapabilityReport,
  isRequiredCapability,
  missingFromReport,
  remainingStandIns,
} from '@astra/contracts';
import { capabilityReport, VERIFIED_IMPLEMENTATIONS } from '../src/index.js';

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

describe('connections are observed, not declared', () => {
  it('is unverified until something has actually connected', () => {
    /*
     * 設定を見ても、設定が正しいかは分からない。
     * **繋がった実績があるかどうか**だけが確かめられる事実。
     */
    const configured = report({ ASTRA_OAUTH_GOOGLE_CLIENT_ID: 'g' });
    const oauth = configured.items.find((i) => i.capability === 'oauth_providers')!;
    expect(oauth.isStandIn).toBe(false);
    expect(oauth.verification).toBe('unverified');
  });

  it('becomes verified once a connection exists', () => {
    const connected = capabilityReport({
      ...providers(),
      env: { ASTRA_OAUTH_GOOGLE_CLIENT_ID: 'g' },
      observed: { oauthConnected: true },
    } as never);
    const oauth = connected.items.find((i) => i.capability === 'oauth_providers')!;
    expect(oauth.verification).toBe('verified');
  });

  it('does not call it verified just because a connection exists somewhere', () => {
    // 設定が無ければ、繋がっているはずがない
    const noClient = capabilityReport({
      ...providers(),
      env: {},
      observed: { oauthConnected: true },
    } as never);
    const oauth = noClient.items.find((i) => i.capability === 'oauth_providers')!;
    expect(oauth.isStandIn).toBe(true);
    expect(oauth.verification).not.toBe('verified');
  });
});

describe('what we are allowed to call verified', () => {
  it('has a record behind every name', async () => {
    /*
     * この一覧は手で書き足せる。**書き足しただけで verified になる。**
     * だから「実測の記録に、その名前が実際に現れるか」を機械で見る。
     * 見張らないと、ここはいずれ願望の置き場になる。
     */
    const { readdir, readFile } = await import('node:fs/promises');
    const path = await import('node:path');
    const { fileURLToPath } = await import('node:url');

    const dir = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      '../../../docs/evidence',
    );
    const files = await readdir(dir);
    const evidence = (
      await Promise.all(
        files.filter((f) => f.endsWith('.md')).map((f) => readFile(path.join(dir, f), 'utf8')),
      )
    ).join('\n');

    const unbacked = [...VERIFIED_IMPLEMENTATIONS].filter((name) => !evidence.includes(name));
    expect(
      unbacked,
      `実測の記録に現れない名前が verified を名乗っている: ${unbacked.join(', ')}`,
    ).toEqual([]);
  });

  it('does not call a stand-in verified', () => {
    for (const item of report().items) {
      if (item.isStandIn) expect(item.verification).not.toBe('verified');
    }
  });
});

describe('starting production', () => {
  it('refuses on something nobody has confirmed here', () => {
    /*
     * 代役でなくても、**一度も確かめていないもので本番を始めない。**
     * 設定を書き間違えていても起動は通ってしまい、
     * 最初の利用者が最初の失敗を踏むことになる。
     */
    const unconfirmed = buildCapabilityReport(
      Object.fromEntries(
        EXTERNAL_CAPABILITIES.map((capability) => [
          capability,
          {
            implementation: 'real-but-untried',
            isStandIn: false,
            configureWith: null,
            verification: 'unverified' as const,
          },
        ]),
      ) as never,
    );

    expect(() => assertReadyForProduction(unconfirmed, 'production')).toThrow(
      /never been confirmed/,
    );
    // 本番以外では止めない。開発のたびに実接続を強いない。
    expect(assertReadyForProduction(unconfirmed, 'development').warn).toContain('never confirmed');
  });

  it('starts when every required capability has been confirmed', () => {
    const confirmed = buildCapabilityReport(
      Object.fromEntries(
        EXTERNAL_CAPABILITIES.map((capability) => [
          capability,
          isRequiredCapability(capability)
            ? {
                implementation: 'real',
                isStandIn: false,
                configureWith: null,
                verification: 'verified' as const,
              }
            : // 任意のものは未設定でよい
              { implementation: 'none', isStandIn: true, configureWith: 'x' },
        ]),
      ) as never,
    );
    expect(() => assertReadyForProduction(confirmed, 'production')).not.toThrow();
  });
});
