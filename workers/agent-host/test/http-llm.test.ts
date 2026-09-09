import { describe, expect, it, vi } from 'vitest';
import { HttpLlmClient } from '../src/http-llm.js';

describe('HTTP/local LLM adapter', () => {
  it('probes and sends through an OpenAI-compatible endpoint without exposing the key in the body', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
      if (String(input).endsWith('/models')) return new Response('{}', { status: 200 });
      expect(init?.headers).toMatchObject({ authorization: 'Bearer secret' });
      const body = JSON.parse(String(init?.body)) as {
        model: string;
        messages: { content: string }[];
      };
      expect(body.model).toBe('local-model');
      expect(JSON.stringify(body)).not.toContain('secret');
      expect(body).toMatchObject({ response_format: { type: 'json_object' } });
      return new Response(
        JSON.stringify({ choices: [{ message: { content: '{"answer":"ok"}' } }] }),
        { status: 200 },
      );
    });
    const client = new HttpLlmClient({
      kind: 'openai_api',
      endpoint: 'http://127.0.0.1:11434/v1',
      model: 'local-model',
      apiKey: 'secret',
      fetch,
    });
    await expect(client.probe()).resolves.toMatchObject({ available: true });
    await expect(client.ask('hello')).resolves.toEqual({ answer: 'ok' });
  });
});
