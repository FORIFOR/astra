/**
 * Google Cloud の実接続。正本 §11.2・§12.2。
 *
 * SDK ではなく **REST + ADC** を使う。
 *
 *   - `@google-cloud/speech` / `@google-cloud/translate` は依存が重い。
 *     使うのは 2 つの endpoint だけなので、割に合わない
 *   - 資格情報は **ADC**（`gcloud auth application-default login` か、
 *     実行環境のサービスアカウント）。**鍵ファイルをリポジトリへ置かない**（§21）
 *
 * ここが持つのは「呼ぶ」ことだけ。何を訳すか・何を起こすかは呼ぶ側が決める。
 */
import { randomUUID } from 'node:crypto';
import { GoogleAuth } from 'google-auth-library';

import type { TranslateClient, V2SpeechClient } from './google.js';
import { locationOf, resolveSpeechEndpoint } from './google-streaming.js';

/** ADC が要求する scope。**これ以上を求めない。** */
const SCOPES = ['https://www.googleapis.com/auth/cloud-platform'];

export interface GoogleRestConfig {
  /** 課金と割り当ての先。ADC が利用者資格情報のときは必須。 */
  readonly projectId: string;
  /** Private, same-project temporary audio bucket for recordings longer than 60 seconds. */
  readonly audioBucket?: string | undefined;
  /** 差し替え可能にしてあるのは、試験で実際に呼ばないため。 */
  readonly fetch?: typeof globalThis.fetch;
  /** access token を返すもの。省略で ADC。 */
  readonly token?: () => Promise<string>;
}

function tokenSource(config: GoogleRestConfig): () => Promise<string> {
  if (config.token) return config.token;
  const auth = new GoogleAuth({ scopes: SCOPES });
  return async () => {
    const client = await auth.getClient();
    const token = await client.getAccessToken();
    if (!token.token) {
      // 取れなかったことを、空文字で先へ進めない
      throw new Error('could not obtain an access token from the ambient credentials');
    }
    return token.token;
  };
}

async function callJson(
  url: string,
  body: unknown,
  config: GoogleRestConfig,
  getToken: () => Promise<string>,
): Promise<unknown> {
  const doFetch = config.fetch ?? globalThis.fetch;
  const response = await doFetch(url, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${await getToken()}`,
      // 利用者資格情報の ADC では、これが無いと 403 になる
      'x-goog-user-project': config.projectId,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  const text = await response.text();
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    throw new Error(`Google replied with ${response.status} and no readable body`);
  }
  if (!response.ok) {
    const message =
      (parsed as { error?: { message?: string } })?.error?.message ?? `status ${response.status}`;
    /*
     * **API が有効でないことを、翻訳の失敗と混ぜない。**
     * 直し方が違う（コンソールで有効化する / 入力を直す）。
     */
    throw new Error(message);
  }
  return parsed;
}

/**
 * Cloud Translation v3。
 *
 * `GoogleTranslationProvider` が期待する形（SDK と同じ tuple）に合わせてある。
 * 呼ぶ側を SDK 前提のまま置いておけるようにするため。
 */
export function translateClientFromEnv(config: GoogleRestConfig): TranslateClient {
  const getToken = tokenSource(config);
  return {
    async translateText(request: unknown) {
      const parameters = request as {
        parent: string;
        contents: string[];
        mimeType?: string;
        sourceLanguageCode?: string;
        targetLanguageCode: string;
      };
      const url = `https://translation.googleapis.com/v3/${parameters.parent}:translateText`;
      const body = await callJson(
        url,
        {
          contents: parameters.contents,
          mimeType: parameters.mimeType ?? 'text/plain',
          ...(parameters.sourceLanguageCode
            ? { sourceLanguageCode: parameters.sourceLanguageCode }
            : {}),
          targetLanguageCode: parameters.targetLanguageCode,
        },
        config,
        getToken,
      );
      return [body as { translations?: readonly { translatedText?: string | null }[] | null }];
    },
  };
}

/**
 * Speech-to-Text v2。正本 §11.2 の Final Accuracy Path。
 *
 * **live path はここではない。**live は streaming が要るので、
 * 別の口（`StreamingTranscriber`）のまま。
 */
/**
 * recognizer のパスから endpoint を決める。
 *
 * V2 は **location ごとに endpoint が違う。**`locations/us` を
 * `speech.googleapis.com` へ投げると、そこには無いと言われる。
 * Chirp 3 は `us` / `eu` の multi-region 提供なので、ここを間違えると
 * 「モデルが無い」に見える（実際には endpoint 違い）。
 *
 * host の組み立ては `resolveSpeechEndpoint` が唯一の入口。
 * 2 箇所で組むと、片方だけ直る。
 */
export function speechEndpoint(recognizer: string): string {
  return `https://${resolveSpeechEndpoint(locationOf(recognizer))}`;
}

export function speechV2ClientFromEnv(config: GoogleRestConfig): V2SpeechClient {
  const getToken = tokenSource(config);
  return {
    async recognize(request: unknown) {
      const parameters = request as { recognizer: string; content?: unknown };
      const decoding = (
        request as {
          config?: {
            explicitDecodingConfig?: { sampleRateHertz?: number; audioChannelCount?: number };
          };
        }
      ).config?.explicitDecodingConfig;
      if (
        parameters.content instanceof Uint8Array &&
        decoding?.sampleRateHertz &&
        parameters.content.byteLength >
          decoding.sampleRateHertz * (decoding.audioChannelCount ?? 1) * 2 * 60
      ) {
        return [
          (await recognizeLongAudio(
            request as { recognizer: string; config: unknown; content: Uint8Array },
            config,
            getToken,
          )) as { results?: readonly never[] | null },
        ];
      }
      const url = `${speechEndpoint(parameters.recognizer)}/v2/${parameters.recognizer}:recognize`;

      /*
       * REST は音声を base64 で受ける。SDK はバイト列をそのまま渡せるので、
       * **ここで直さないと、JSON.stringify がバイト列を
       * `{"0":82,"1":73,...}` にして送り、無音として通ってしまう。**
       * 落ちるのではなく、静かに何も聞こえない結果になる。
       */
      const body =
        parameters.content instanceof Uint8Array
          ? { ...parameters, content: Buffer.from(parameters.content).toString('base64') }
          : request;

      const parsed = (await callJson(url, body, config, getToken)) as {
        results?: readonly unknown[] | null;
      };
      return [parsed as { results?: readonly never[] | null }];
    },
  };
}

/** Keep the complete conversation together for diarization; do not cut words at minute boundaries. */
async function recognizeLongAudio(
  request: { recognizer: string; config: unknown; content: Uint8Array },
  config: GoogleRestConfig,
  getToken: () => Promise<string>,
): Promise<{ results?: readonly unknown[] | null }> {
  if (!config.audioBucket)
    throw new Error('GOOGLE_STT_AUDIO_BUCKET is required for recordings longer than 60 seconds');
  const bucket = encodeURIComponent(config.audioBucket);
  const name = `stt-temporary/${randomUUID()}.pcm`;
  const object = `https://storage.googleapis.com/storage/v1/b/${bucket}/o/${encodeURIComponent(name)}`;
  const uri = `gs://${config.audioBucket}/${name}`;
  const doFetch = config.fetch ?? globalThis.fetch;
  const headers = async () => ({
    authorization: `Bearer ${await getToken()}`,
    'x-goog-user-project': config.projectId,
  });
  const uploaded = await doFetch(
    `https://storage.googleapis.com/upload/storage/v1/b/${bucket}/o?uploadType=media&name=${encodeURIComponent(name)}&ifGenerationMatch=0`,
    {
      method: 'POST',
      headers: { ...(await headers()), 'content-type': 'application/octet-stream' },
      body: Buffer.from(request.content),
      signal: AbortSignal.timeout(120_000),
    },
  );
  if (!uploaded.ok) throw new Error(`temporary STT audio upload failed (${uploaded.status})`);
  try {
    const endpoint = speechEndpoint(request.recognizer);
    const operation = (await callJson(
      `${endpoint}/v2/${request.recognizer}:batchRecognize`,
      {
        recognizer: request.recognizer,
        config: request.config,
        files: [{ uri }],
        recognitionOutputConfig: { inlineResponseConfig: {} },
      },
      config,
      getToken,
    )) as { name?: string };
    if (!operation.name || !operation.name.startsWith('projects/'))
      throw new Error('Google did not return a batch operation');
    const deadline = Date.now() + 25 * 60_000;
    while (Date.now() < deadline) {
      const response = await doFetch(`${endpoint}/v2/${operation.name}`, {
        headers: await headers(),
        signal: AbortSignal.timeout(60_000),
      });
      if (!response.ok) throw new Error(`Google batch status failed (${response.status})`);
      const status = (await response.json()) as {
        done?: boolean;
        error?: { message?: string };
        response?: {
          results?: Record<
            string,
            {
              error?: { message?: string };
              transcript?: { results?: readonly unknown[] };
              inlineResult?: { transcript?: { results?: readonly unknown[] } };
            }
          >;
        };
      };
      if (status.error) throw new Error(status.error.message ?? 'Google batch failed');
      if (status.done) {
        const result = status.response?.results?.[uri];
        if (result?.error)
          throw new Error(result.error.message ?? 'Google file transcription failed');
        const transcript = result?.inlineResult?.transcript ?? result?.transcript;
        if (!transcript) throw new Error('Google batch completed without a transcript');
        return transcript;
      }
      await new Promise((resolve) => setTimeout(resolve, 2_000));
    }
    throw new Error('Google batch transcription timed out');
  } finally {
    const removed = await doFetch(object, {
      method: 'DELETE',
      headers: await headers(),
      signal: AbortSignal.timeout(60_000),
    });
    if (!removed.ok && removed.status !== 404)
      throw new Error(`temporary STT audio cleanup failed (${removed.status})`);
  }
}
