/**
 * 端末で言語モデルを呼ぶ側。正本 §8・§21、UI/UX §22。
 *
 * 見るのは:
 *   - 使えるものが無いときに、**運営側のモデルへ落ちない**
 *   - 契約が決めた順で選ぶ
 *   - 失敗を種類ごとに返す
 *   - 原文に無い根拠を作らせない指示が入っている
 */
import { describe, expect, it, vi } from 'vitest';
import { NO_MODEL_MESSAGE, type LanguageModelOption } from '@astra/contracts';
import { ClaudeCodeCli, ClaudeCodeError, type RunResult } from '../src/claude-code.js';
import { LlmRuntime, promptFor } from '../src/llm-steps.js';
import type { HostStep } from '../src/connector-steps.js';

const step = (over: Partial<HostStep> = {}): HostStep => ({
  id: 'req-1',
  toolId: 'llm.decompose',
  args: { question: 'A社の競合は？', max: 3 },
  approval: null,
  ...over,
});

const cliReturning = (result: Partial<RunResult>): ClaudeCodeCli =>
  new ClaudeCodeCli({
    run: async (): Promise<RunResult> => ({ code: 0, stdout: '', stderr: '', ...result }),
  });

const reply = (value: unknown): string =>
  JSON.stringify({ type: 'result', result: JSON.stringify(value) });

const keyOption = (kind: LanguageModelOption['kind'], available: boolean): LanguageModelOption => ({
  kind,
  available,
  reason: available ? null : 'キーが登録されていません。',
  credential: 'keychain',
  implementation: null,
});

describe('choosing what to answer with', () => {
  it('refuses rather than falling back when nothing is available', async () => {
    const runtime = new LlmRuntime({
      claudeCode: cliReturning({ code: null, stderr: 'ENOENT' }),
    });
    const outcome = await runtime.run(step());

    expect(outcome.ok).toBe(false);
    expect(outcome.error!.code).toBe('llm.no_model');
    // §22: 使えないと言う。黙って劣化しない。
    expect(outcome.error!.message).toBe(NO_MODEL_MESSAGE);
  });

  it('prefers Claude Code over a stored key, as the contract says', async () => {
    const viaKey = vi.fn();
    const runtime = new LlmRuntime({
      claudeCode: cliReturning({ stdout: '2.0.14' }),
      others: [keyOption('anthropic_api', true)],
      askWith: {
        claude_code: async () => ({ queries: ['a'] }),
        anthropic_api: viaKey,
      },
    });

    expect((await runtime.run(step())).ok).toBe(true);
    expect(viaKey).not.toHaveBeenCalled();
  });

  it('uses the stored key when Claude Code is not on this device', async () => {
    const runtime = new LlmRuntime({
      claudeCode: cliReturning({ code: null, stderr: 'ENOENT' }),
      others: [keyOption('anthropic_api', true)],
      askWith: { anthropic_api: async () => ({ queries: ['a', 'b'] }) },
    });
    const outcome = await runtime.run(step());
    expect(outcome.ok).toBe(true);
    expect(outcome.result).toEqual({ queries: ['a', 'b'] });
  });

  it('does not probe the device on every single call', async () => {
    const run = vi.fn(async (): Promise<RunResult> => ({ code: 0, stdout: '2.0.14', stderr: '' }));
    const runtime = new LlmRuntime({
      claudeCode: new ClaudeCodeCli({ run }),
      askWith: { claude_code: async () => ({ queries: [] }) },
    });

    await runtime.run(step());
    await runtime.run(step());
    await runtime.run(step());
    // 1 回の調査で何十回もプロセスを立てない
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('looks again after Claude Code disappears', async () => {
    let installed = true;
    const run = vi.fn(async (_c: string, args: readonly string[]): Promise<RunResult> => {
      if (args.includes('--version')) {
        return installed
          ? { code: 0, stdout: '2.0.14', stderr: '' }
          : { code: null, stdout: '', stderr: 'ENOENT' };
      }
      return installed
        ? { code: 0, stdout: reply({ queries: ['a'] }), stderr: '' }
        : { code: null, stdout: '', stderr: 'ENOENT' };
    });
    const runtime = new LlmRuntime({ claudeCode: new ClaudeCodeCli({ run }) });

    expect((await runtime.run(step())).ok).toBe(true);
    installed = false;
    const gone = await runtime.run(step());
    expect(gone.error!.code).toBe('llm.not_installed');

    // 覚えたままだと、入れ直しても永久に「無い」ままになる
    installed = true;
    expect((await runtime.run(step())).ok).toBe(true);
  });
});

describe('what comes back when it goes wrong', () => {
  /*
   * 入っていない場合はここに載せない。probe の時点で「使えるものが無い」に
   * なるので、返るのは `llm.no_model` になる。上の試験で見ている。
   */
  const cases: { stderr: string; code: number | null; expected: string }[] = [
    { code: 1, stderr: 'Not logged in', expected: 'llm.not_signed_in' },
    { code: 1, stderr: 'usage limit reached', expected: 'llm.rate_limited' },
    { code: 139, stderr: 'segmentation fault', expected: 'llm.crashed' },
  ];

  for (const { code, stderr, expected } of cases) {
    it(`reports ${expected}`, async () => {
      let probed = false;
      const runtime = new LlmRuntime({
        claudeCode: new ClaudeCodeCli({
          run: async (_c, args): Promise<RunResult> => {
            if (args.includes('--version') && !probed) {
              probed = true;
              // 入っていない場合は probe も失敗する
              return code === null
                ? { code: null, stdout: '', stderr }
                : { code: 0, stdout: '2.0.14', stderr: '' };
            }
            return { code, stdout: '', stderr };
          },
        }),
      });

      const outcome = await runtime.run(step());
      expect(outcome.ok).toBe(false);
      expect(outcome.error!.code).toBe(expected);
      expect(outcome.error!.message.length).toBeGreaterThan(0);
    });
  }

  it('does not turn an unreadable reply into an empty answer', async () => {
    const runtime = new LlmRuntime({
      claudeCode: new ClaudeCodeCli({
        run: async (_c, args): Promise<RunResult> =>
          args.includes('--version')
            ? { code: 0, stdout: '2.0.14', stderr: '' }
            : { code: 0, stdout: 'sorry, here is my answer', stderr: '' },
      }),
    });
    const outcome = await runtime.run(step());
    // 空の答えは「調べたが何も無かった」に見える。読めなかったのとは違う。
    expect(outcome.error!.code).toBe('llm.unreadable_output');
  });

  it('does not quietly answer a step it does not handle', async () => {
    const runtime = new LlmRuntime({ claudeCode: cliReturning({ stdout: '2.0.14' }) });
    expect(runtime.handles('mail.send')).toBe(false);
    expect((await runtime.run(step({ toolId: 'mail.send' }))).error!.code).toBe(
      'host.unsupported_step',
    );
  });

  it('says so plainly when the chosen way is not wired up', async () => {
    const runtime = new LlmRuntime({
      others: [keyOption('gemini_api', true)],
    });
    const outcome = await runtime.run(step());
    expect(outcome.error!.code).toBe('llm.not_wired');
    expect(outcome.error!.message).toContain('Gemini');
  });
});

describe('what the device asks the model', () => {
  it('will not let a claim be supported by words that are not in the source', () => {
    const prompt = promptFor('llm.extract_claims', {
      question: 'A社の売上は？',
      snippet: '2025年の売上は 120 億円でした。',
      title: '決算',
    });
    expect(prompt).toContain('そのまま現れる文字列');
    expect(prompt).toContain('要約したり言い換えたり');
  });

  it('asks for JSON only, so prose does not become the answer', () => {
    for (const tool of ['llm.decompose', 'llm.synthesize', 'llm.contradictions'] as const) {
      expect(promptFor(tool, { question: 'q', claims: ['a'] })).toContain('JSON だけ');
    }
  });

  it('numbers the claims so the contradiction pairs mean something', () => {
    const prompt = promptFor('llm.contradictions', { claims: ['増えた', '減った'] });
    expect(prompt).toContain('0. 増えた');
    expect(prompt).toContain('1. 減った');
    expect(prompt).toContain('0 から始まります');
  });

  it('does not invite the model to add topics of its own', () => {
    expect(promptFor('llm.decompose', { question: 'q', max: 3 })).toContain(
      '含まれていない話題を足さない',
    );
    expect(promptFor('llm.synthesize', { question: 'q', claims: [] })).toContain(
      '主張に無いことを足さない',
    );
  });
});
