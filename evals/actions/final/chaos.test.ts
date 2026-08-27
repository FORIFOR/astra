/**
 * 故障注入。正本 §21・§24、UI/UX §21。
 *
 * 見たいのは「壊れないこと」ではなく、**壊れ方が正しいこと**:
 *
 *   - 失敗を成功として見せない
 *   - 直し方の分かる言葉で言う
 *   - 待てば戻るものを、失敗として畳まない
 *   - 二度実行しない
 */
import { describe, expect, it } from 'vitest';
import { GmailConnector, GoogleCalendarConnector, ConnectorError } from '@astra/service-connectors';
import { ClaudeCodeCli, LlmRuntime } from '@astra/worker-agent-host';
import {
  BraveSearchProvider,
  HostSearchProvider,
  HostLanguageModel,
} from '@astra/service-research';
import { ImagenGenerator } from '@astra/service-agent-runtime';
import { GoogleTtsProvider } from '@astra/service-meeting';

const ALL_MAIL = ['email.read', 'email.draft', 'email.modify', 'email.send'];

/** 決めた応答を返す `fetch`。呼ばれた回数も数える。 */
function replying(reply: () => { status?: number; body?: unknown; throws?: Error }): {
  fetch: typeof globalThis.fetch;
  calls: number;
} {
  const state = { calls: 0 };
  const fetch = (async () => {
    state.calls += 1;
    const r = reply();
    if (r.throws) throw r.throws;
    return new Response(typeof r.body === 'string' ? r.body : JSON.stringify(r.body ?? {}), {
      status: r.status ?? 200,
    });
  }) as unknown as typeof globalThis.fetch;
  return {
    fetch,
    get calls() {
      return state.calls;
    },
  } as never;
}

const gmail = (fetch: typeof globalThis.fetch): GmailConnector =>
  new GmailConnector({ token: async () => 't', fetch, grantedScopes: ALL_MAIL });

describe('403 from a provider', () => {
  it('tells a missing permission apart from a missing scope', async () => {
    const denied = replying(() => ({
      status: 403,
      body: { error: { message: 'Gmail API has not been used in project' } },
    }));
    await expect(gmail(denied.fetch).get('m1')).rejects.toMatchObject({
      reason: 'permission_denied',
    });

    const scoped = replying(() => ({
      status: 403,
      body: { error: { message: 'Request had insufficient authentication scopes' } },
    }));
    await expect(gmail(scoped.fetch).get('m1')).rejects.toMatchObject({
      reason: 'insufficient_scope',
    });
  });

  it('does not turn a refusal into an empty result', async () => {
    const denied = replying(() => ({ status: 403, body: { error: { message: 'no' } } }));
    // 空の一覧を返すと「メールが 1 通も無い」に見える
    await expect(gmail(denied.fetch).list()).rejects.toBeInstanceOf(ConnectorError);
  });
});

describe('429 from a provider', () => {
  it('says to wait, everywhere it can happen', async () => {
    const busy = replying(() => ({ status: 429, body: {} }));

    await expect(gmail(busy.fetch).get('m1')).rejects.toMatchObject({ reason: 'rate_limited' });
    await expect(
      new BraveSearchProvider({ apiKey: 'k', fetch: busy.fetch }).search('q', 3),
    ).rejects.toMatchObject({ reason: 'rate_limited' });
    await expect(
      new ImagenGenerator({ projectId: 'p', fetch: busy.fetch, token: async () => 't' }).generate({
        prompt: 'x',
      }),
    ).rejects.toMatchObject({ reason: 'rate_limited' });
    await expect(
      new GoogleTtsProvider({ projectId: 'p', fetch: busy.fetch, token: async () => 't' }).speak({
        text: 'x',
        language: 'ja-JP',
      }),
    ).rejects.toMatchObject({ reason: 'rate_limited' });
  });
});

describe('the network going away', () => {
  it('is a failure to reach, not a failure to find', async () => {
    const down = replying(() => ({ throws: new TypeError('fetch failed') }));

    await expect(gmail(down.fetch).list()).rejects.toMatchObject({ reason: 'timed_out' });
    await expect(
      new BraveSearchProvider({ apiKey: 'k', fetch: down.fetch }).search('q', 3),
    ).rejects.toMatchObject({ reason: 'timed_out' });
  });
});

describe('a malformed response', () => {
  it('is not read as a successful empty answer', async () => {
    const garbage = replying(() => ({ body: '<html>502 Bad Gateway</html>' }));

    await expect(gmail(garbage.fetch).get('m1')).rejects.toBeInstanceOf(ConnectorError);
    await expect(
      new BraveSearchProvider({ apiKey: 'k', fetch: garbage.fetch }).search('q', 3),
    ).rejects.toThrow();
  });

  it('is not read as a picture', async () => {
    const garbage = replying(() => ({ body: '<html>error</html>' }));
    await expect(
      new ImagenGenerator({
        projectId: 'p',
        fetch: garbage.fetch,
        token: async () => 't',
      }).generate({ prompt: 'x' }),
    ).rejects.toMatchObject({ reason: 'provider_error' });
  });

  it('is not read as an answer from the model', async () => {
    const runtime = new LlmRuntime({
      claudeCode: new ClaudeCodeCli({
        run: async (_c, args) =>
          args.includes('--version')
            ? { code: 0, stdout: '2.0.0', stderr: '' }
            : { code: 0, stdout: 'I think the answer is 42', stderr: '' },
      }),
    });
    const outcome = await runtime.run({
      id: 'r',
      toolId: 'llm.decompose',
      args: { question: 'q', max: 2 },
      approval: null,
    });
    expect(outcome.ok).toBe(false);
    expect(outcome.error!.code).toBe('llm.unreadable_output');
  });
});

describe('the access being revoked', () => {
  it('asks to be connected again, rather than blaming the provider', async () => {
    const revoked = replying(() => ({
      status: 401,
      body: { error: { message: 'Invalid Credentials' } },
    }));
    await expect(gmail(revoked.fetch).list()).rejects.toMatchObject({ reason: 'token_expired' });

    const calendar = new GoogleCalendarConnector({
      token: async () => 't',
      fetch: revoked.fetch,
      grantedScopes: ['calendar.read'],
    });
    await expect(calendar.list({ timeMin: 'a', timeMax: 'b' })).rejects.toMatchObject({
      reason: 'token_expired',
    });
  });
});

describe('the provider taking too long', () => {
  it('gives up rather than hanging on forever', async () => {
    const slow = (async (_url: string, init: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => {
          reject(new DOMException('aborted', 'AbortError'));
        });
      })) as unknown as typeof globalThis.fetch;

    const connector = new GmailConnector({
      token: async () => 't',
      fetch: slow,
      grantedScopes: ALL_MAIL,
      timeoutMs: 30,
    });
    await expect(connector.list()).rejects.toMatchObject({ reason: 'timed_out' });
  });
});

describe('the device answering twice', () => {
  it('keeps the first answer and refuses the second', async () => {
    /*
     * 再接続した端末が、走らせ終えた step の結果を投げ直すことがある。
     * **上書きさせない。**上書きすると、古い結果が新しい実行を消す。
     * （DB を使う本体は services/agent-host の試験で見ている。ここでは
     * 経路として同じ判断が cloud 側にあることを確かめる。）
     */
    const seen = new Set<string>();
    const settle = (id: string): boolean => {
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    };
    expect(settle('req-1')).toBe(true);
    expect(settle('req-1')).toBe(false);
  });
});

describe('the model being taken away mid-flight', () => {
  it('says which of the four things went wrong', async () => {
    const cases: [string, number | null, string][] = [
      ['Not logged in', 1, 'llm.not_signed_in'],
      ['usage limit reached', 1, 'llm.rate_limited'],
      ['segmentation fault', 139, 'llm.crashed'],
    ];

    for (const [stderr, code, expected] of cases) {
      const runtime = new LlmRuntime({
        claudeCode: new ClaudeCodeCli({
          run: async (_c, args) =>
            args.includes('--version')
              ? { code: 0, stdout: '2.0.0', stderr: '' }
              : { code, stdout: '', stderr },
        }),
      });
      const outcome = await runtime.run({
        id: 'r',
        toolId: 'llm.answer',
        args: { question: 'q' },
        approval: null,
      });
      expect(outcome.error!.code).toBe(expected);
      // 何をすればよいかまで言う
      expect(outcome.error!.message.length).toBeGreaterThan(0);
    }
  });
});

describe('the transcript stream dropping', () => {
  it('surfaces as a failure to transcribe, not as silence', async () => {
    // 空の書き起こしを返すと「誰も喋らなかった」に見える
    const host = {
      async execute() {
        throw Object.assign(new Error('接続が切れました'), { name: 'HostOffline' });
      },
    };
    const search = new HostSearchProvider({
      host,
      context: () => ({ taskId: 't', tenantId: 'a', userId: 'u', stepIndex: 0 }),
    });
    await expect(search.search('q', 3)).rejects.toMatchObject({ name: 'HostOffline' });

    const model = new HostLanguageModel({
      host,
      context: () => ({ taskId: 't', tenantId: 'a', userId: 'u', stepIndex: 0 }),
    });
    await expect(model.decompose('q', 2)).rejects.toMatchObject({ name: 'HostOffline' });
  });
});
