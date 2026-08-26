/**
 * Google Cloud の実接続。正本 §11.2・§12.2・§21。
 *
 * **実際には呼ばない。**呼ぶ形が正しいことと、
 * 失敗の伝え方が正しいことを見る。
 */
import { describe, expect, it, vi } from 'vitest';
import { speechV2ClientFromEnv, translateClientFromEnv } from '../src/google-rest.js';

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const config = (fetchImpl: typeof globalThis.fetch) => ({
  projectId: 'astra-test',
  fetch: fetchImpl,
  // ADC を触らない。試験が環境の資格情報に依存しないため。
  token: async () => 'test-token',
});

describe('translation', () => {
  it('calls v3 with the parent in the path, and the project in the header', async () => {
    const seen: { url: string; init: RequestInit }[] = [];
    const client = translateClientFromEnv(
      config(async (url, init) => {
        seen.push({ url: String(url), init: init! });
        return json({ translations: [{ translatedText: '雨が止んだ。' }] });
      }),
    );

    const [response] = await client.translateText({
      parent: 'projects/astra-test/locations/global',
      contents: ['The rain stopped.'],
      targetLanguageCode: 'ja',
    });

    expect(seen[0]!.url).toBe(
      'https://translation.googleapis.com/v3/projects/astra-test/locations/global:translateText',
    );
    const headers = seen[0]!.init.headers as Record<string, string>;
    // 利用者資格情報の ADC では、これが無いと 403 になる
    expect(headers['x-goog-user-project']).toBe('astra-test');
    expect(headers['authorization']).toBe('Bearer test-token');
    expect(response.translations?.[0]?.translatedText).toBe('雨が止んだ。');
  });

  it('leaves the source language out when it was not given', async () => {
    let body = '';
    const client = translateClientFromEnv(
      config(async (_url, init) => {
        body = String(init?.body);
        return json({ translations: [] });
      }),
    );
    await client.translateText({
      parent: 'projects/astra-test/locations/global',
      contents: ['x'],
      targetLanguageCode: 'ja',
    });
    // 指定が無いなら自動判定に任せる。空文字を送らない。
    expect(JSON.parse(body)).not.toHaveProperty('sourceLanguageCode');
  });

  it('passes the provider message through when the API is not enabled', async () => {
    const client = translateClientFromEnv(
      config(async () =>
        json(
          { error: { code: 403, message: 'Cloud Translation API has not been used in project' } },
          403,
        ),
      ),
    );
    // 「有効化されていない」と「訳せなかった」を混ぜない。直し方が違う。
    await expect(
      client.translateText({
        parent: 'p',
        contents: ['x'],
        targetLanguageCode: 'ja',
      }),
    ).rejects.toThrow(/has not been used/);
  });

  it('does not pretend to succeed on an unreadable reply', async () => {
    const client = translateClientFromEnv(
      config(async () => new Response('<html>502</html>', { status: 502 })),
    );
    await expect(
      client.translateText({ parent: 'p', contents: ['x'], targetLanguageCode: 'ja' }),
    ).rejects.toThrow(/502/);
  });

  it('refuses to continue when no token could be obtained', async () => {
    const client = translateClientFromEnv({
      projectId: 'astra-test',
      fetch: async () => json({}),
      token: async () => {
        throw new Error('no credentials');
      },
    });
    // 空文字で先へ進めない
    await expect(
      client.translateText({ parent: 'p', contents: ['x'], targetLanguageCode: 'ja' }),
    ).rejects.toThrow(/no credentials/);
  });
});

describe('speech v2', () => {
  it('calls recognize on the recognizer resource', async () => {
    const seen: string[] = [];
    const client = speechV2ClientFromEnv(
      config(async (url) => {
        seen.push(String(url));
        return json({ results: [] });
      }),
    );
    await client.recognize({
      recognizer: 'projects/astra-test/locations/global/recognizers/_',
    });
    expect(seen[0]).toBe(
      'https://speech.googleapis.com/v2/projects/astra-test/locations/global/recognizers/_:recognize',
    );
  });

  it('reports a disabled API rather than returning nothing', async () => {
    const client = speechV2ClientFromEnv(
      config(async () =>
        json({ error: { message: 'Cloud Speech-to-Text API has not been used' } }, 403),
      ),
    );
    // 空の結果を返すと、「話していなかった」ように見える
    await expect(client.recognize({ recognizer: 'r' })).rejects.toThrow(/has not been used/);
  });
});

describe('choosing real over stand-in', () => {
  it('stays a stand-in until a project is configured', async () => {
    const { meetingProvidersFromEnv } = await import('../src/factory.js');
    const providers = await meetingProvidersFromEnv({
      GOOGLE_TRANSLATE_PARENT: 'projects/x/locations/global',
    });
    // 設定が無いなら代役。**seam があるだけで本物になったことにしない。**
    expect(providers.translation.isStandIn).toBe(true);
  });

  it('becomes real once the project and the parent are both there', async () => {
    const { meetingProvidersFromEnv } = await import('../src/factory.js');
    const providers = await meetingProvidersFromEnv({
      GOOGLE_CLOUD_PROJECT: 'astra-test',
      GOOGLE_TRANSLATE_PARENT: 'projects/astra-test/locations/global',
    });
    expect(providers.translation.isStandIn).toBe(false);
  });

  it('needs the recognizer as well before the batch path is real', async () => {
    const { meetingProvidersFromEnv } = await import('../src/factory.js');
    const withoutRecognizer = await meetingProvidersFromEnv({
      GOOGLE_CLOUD_PROJECT: 'astra-test',
    });
    expect(withoutRecognizer.batch.isStandIn).toBe(true);

    const withRecognizer = await meetingProvidersFromEnv({
      GOOGLE_CLOUD_PROJECT: 'astra-test',
      GOOGLE_STT_RECOGNIZER: 'projects/astra-test/locations/global/recognizers/_',
    });
    expect(withRecognizer.batch.isStandIn).toBe(false);
  });
});
