import { describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { CodexCli } from '../src/codex.js';
import { LlmRuntime } from '../src/llm-steps.js';
import { isAllowedCredentialLocation } from '@astra/contracts';

const answer = [
  { type: 'item.completed', item: { type: 'agent_message', text: '{"answer":"read the image"}' } },
  { type: 'turn.completed' },
]
  .map((x) => JSON.stringify(x))
  .join('\n');

describe('Codex CLI', () => {
  it('requires login, not just installation', async () => {
    const cli = new CodexCli({
      run: async (_, args) => ({
        code: args[0] === 'login' ? 1 : 0,
        stdout: 'version',
        stderr: '',
      }),
    });
    expect((await cli.probe()).available).toBe(false);
    expect(isAllowedCredentialLocation('codex', 'keychain')).toBe(false);
    expect(isAllowedCredentialLocation('codex', 'codex')).toBe(true);
  });

  it('attaches only provided images and removes the isolated workspace', async () => {
    let directory = '';
    const cli = new CodexCli({
      run: async (_, args, options) => {
        directory = args[args.indexOf('-C') + 1]!;
        expect(existsSync(directory)).toBe(true);
        expect(args).toContain('--ignore-user-config');
        expect(args).toContain('read-only');
        expect(args).toContain('features.shell_tool=false');
        expect(args).toContain('web_search="disabled"');
        expect(args[args.indexOf('--image') + 1]).toBe('/test/image.png');
        expect(options.input).toBe('question');
        return { code: 0, stdout: answer, stderr: '' };
      },
    });
    expect(await cli.ask('question', { images: ['/test/image.png'] })).toEqual({
      answer: 'read the image',
    });
    expect(existsSync(directory)).toBe(false);
  });

  it('does not accept a failed or incomplete turn as an answer', async () => {
    for (const stdout of [
      answer.replace('turn.completed', 'turn.failed'),
      answer.split('\n')[0]!,
      'garbled',
    ]) {
      const cli = new CodexCli({ run: async () => ({ code: 0, stdout, stderr: '' }) });
      await expect(cli.ask('question')).rejects.toThrow();
    }
  });

  it('routes a host language step through Codex without Claude', async () => {
    const cli = new CodexCli({
      run: async (_, args) => ({
        code: 0,
        stdout: args[0] === 'exec' ? answer : 'codex',
        stderr: '',
      }),
    });
    const runtime = new LlmRuntime({ codex: cli });
    expect((await runtime.options())[0]?.kind).toBe('codex');
    const result = await runtime.run({
      id: 'test',
      toolId: 'llm.answer',
      args: { question: 'question' },
      approval: null,
    });
    expect(result).toEqual({ ok: true, result: { answer: 'read the image' } });
  });
});
