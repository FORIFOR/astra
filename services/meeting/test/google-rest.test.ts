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

describe('what the REST transport changed', () => {
  it('reads a duration string as well as the SDK object', async () => {
    const { durationToMs } = await import('../src/google.js');
    // SDK (gRPC)
    expect(durationToMs({ seconds: 4, nanos: 870_000_000 })).toBe(4_870);
    // REST。読めないと**時刻だけが静かに消え**、引用と字幕が壊れる
    expect(durationToMs('4.870s')).toBe(4_870);
    expect(durationToMs('11.610s')).toBe(11_610);
    expect(durationToMs('0s')).toBe(0);
    // 壊れた値は 0。落ちるより、時刻が無いほうがまだ扱える
    expect(durationToMs('なにか')).toBe(0);
    expect(durationToMs(null)).toBe(0);
  });

  it('sends the audio as base64, not as a numbered object', async () => {
    let body = '';
    const client = speechV2ClientFromEnv(
      config(async (_url, init) => {
        body = String(init?.body);
        return json({ results: [] });
      }),
    );
    await client.recognize({
      recognizer: 'projects/p/locations/global/recognizers/_',
      content: new Uint8Array([82, 73, 70, 70]),
    });
    /*
     * JSON.stringify はバイト列を {"0":82,...} にする。
     * **落ちずに無音として通ってしまう**ので、ここで固定する。
     */
    expect(JSON.parse(body).content).toBe('UklGRg==');
  });
});

describe('when the recogniser cannot separate speakers', () => {
  const V2_RESULT = {
    results: [
      { alternatives: [{ transcript: '一つ目' }], resultEndOffset: '4.870s' },
      { alternatives: [{ transcript: '二つ目' }], resultEndOffset: '11.610s' },
    ],
  };

  it('drops diarization and keeps the meeting, saying so', async () => {
    const { GoogleBatchTranscriber } = await import('../src/google.js');
    const attempts: unknown[] = [];
    const told: string[] = [];

    const transcriber = new GoogleBatchTranscriber({
      recognizer: 'projects/p/locations/global/recognizers/_',
      onDiarizationUnavailable: (reason) => told.push(reason),
      client: {
        async recognize(request: unknown) {
          attempts.push(request);
          const features = (request as { config: { features: Record<string, unknown> } }).config
            .features;
          if (features['diarizationConfig']) {
            throw new Error('Recognizer does not support feature: speaker_diarization');
          }
          return [V2_RESULT] as never;
        },
      },
    });

    const results = await transcriber.transcribe(new Uint8Array([1, 2, 3, 4]), {
      language: 'ja-JP',
    });

    // 2 回試している（分離あり → 無し）
    expect(attempts).toHaveLength(2);
    // 諦めたことを黙らない
    expect(told[0]).toContain('speaker_diarization');
    // 会議そのものは録れる
    expect(results.map((r) => r.text)).toEqual(['一つ目', '二つ目']);
    // **全部を Speaker 1 にしない。**分からないものは分からないと返す
    expect(results.every((r) => r.speakerTag === null)).toBe(true);
    // 時刻は残る
    expect(results[1]!.endMs).toBe(11_610);
  });

  it('does not swallow a failure that has nothing to do with diarization', async () => {
    const { GoogleBatchTranscriber } = await import('../src/google.js');
    const transcriber = new GoogleBatchTranscriber({
      recognizer: 'r',
      client: {
        async recognize() {
          throw new Error('Cloud Speech-to-Text API has not been used');
        },
      },
    });
    await expect(
      transcriber.transcribe(new Uint8Array([1]), { language: 'ja-JP' }),
    ).rejects.toThrow(/has not been used/);
  });

  it('does not default to a model that is no longer generally available', async () => {
    const { GoogleBatchTranscriber } = await import('../src/google.js');
    let model = '';
    const transcriber = new GoogleBatchTranscriber({
      recognizer: 'r',
      client: {
        async recognize(request: unknown) {
          model = (request as { config: { model: string } }).config.model;
          return [{ results: [] }] as never;
        },
      },
    });
    await transcriber.transcribe(new Uint8Array([1]), { language: 'ja-JP' });
    // chirp_3 は 403（no longer generally available）。既定にすると繋いだ瞬間に落ちる
    expect(model).not.toBe('chirp_3');
    expect(model).toBe('long');
  });
});
