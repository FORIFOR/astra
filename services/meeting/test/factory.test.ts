/**
 * プロバイダの組み立て。Phase 3 §1.1（OQ-11）。
 * **決まっていないことを、決まったふりで埋めない。**
 */
import { describe, expect, it } from 'vitest';
import { meetingProvidersFromEnv, standIns } from '../src/factory.js';

describe('meetingProvidersFromEnv', () => {
  it('names every provider that is still a stand-in', async () => {
    const providers = await meetingProvidersFromEnv({});
    expect(standIns(providers).sort()).toEqual([
      'batch transcriber',
      'streaming transcriber',
      'summarizer',
      'translation',
    ]);
  });

  it('uses Claude for the minutes once a key is configured', async () => {
    const providers = await meetingProvidersFromEnv({ ANTHROPIC_API_KEY: 'k' });
    expect(providers.summarizer.isStandIn).toBe(false);
    // STT はまだ未決なので代役のまま
    expect(standIns(providers)).toContain('streaming transcriber');
    expect(standIns(providers)).not.toContain('summarizer');
  });

  it('stays a stand-in when the recognizer path is missing, even with a client', async () => {
    // 認証情報の片側だけで本物のふりをさせない
    const providers = await meetingProvidersFromEnv(
      {},
      { speechV2: async () => ({ recognize: async () => [{ results: [] }] }) },
    );
    expect(providers.batch.isStandIn).toBe(true);
  });

  it('uses Google once both the client and the path are there', async () => {
    const providers = await meetingProvidersFromEnv(
      { GOOGLE_STT_RECOGNIZER: 'projects/p/locations/global/recognizers/_' },
      { speechV2: async () => ({ recognize: async () => [{ results: [] }] }) },
    );
    expect(providers.batch.isStandIn).toBe(false);
  });
});

describe('assertNoStandIns', () => {
  it('refuses to run in production and says exactly what is missing', async () => {
    const { assertNoStandIns } = await import('../src/factory.js');
    expect(() => assertNoStandIns(['streaming transcriber', 'summarizer'], 'production')).toThrow(
      /streaming transcriber, summarizer/,
    );
  });

  it('does not stop development, but does not go quiet either', async () => {
    const { assertNoStandIns } = await import('../src/factory.js');
    const { warn } = assertNoStandIns(['summarizer'], 'development');
    expect(warn).toContain('summarizer');
  });

  it('says nothing when every provider is real', async () => {
    const { assertNoStandIns } = await import('../src/factory.js');
    expect(assertNoStandIns([], 'production')).toEqual({ warn: null });
  });
});
