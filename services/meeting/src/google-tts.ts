/**
 * Google Cloud Text-to-Speech の実接続。正本 §27。
 *
 * STT / Translation と同じ ADC を使う。**鍵ファイルを置かない**（§21）。
 * REST で足りるので SDK を持ち込まない。
 */
import { GoogleAuth } from 'google-auth-library';
import {
  SpeakError,
  speakProblems,
  type SpeakRequest,
  type SpokenAudio,
  type TtsProvider,
} from '@astra/tts';

const SCOPES = ['https://www.googleapis.com/auth/cloud-platform'];

export interface GoogleTtsConfig {
  readonly projectId: string;
  readonly fetch?: typeof globalThis.fetch;
  readonly token?: () => Promise<string>;
  /** 返らないときに諦めるまで。**待ち続けない。** */
  readonly timeoutMs?: number;
}

/** 応答が返るまでの上限。読み上げは対話の途中なので、長く待たない。 */
const DEFAULT_TIMEOUT_MS = 10_000;

function reasonFor(status: number, message: string): SpeakError {
  if (status === 403) return new SpeakError('permission_denied', message);
  if (status === 429) return new SpeakError('rate_limited', message);
  if (status === 400) {
    // 言語が無いのと、要求が壊れているのを分ける
    return /voice|language/i.test(message)
      ? new SpeakError('unsupported_language', message)
      : new SpeakError('invalid_request', message);
  }
  return new SpeakError('provider_error', message);
}

export class GoogleTtsProvider implements TtsProvider {
  readonly name = 'google-tts';
  readonly isStandIn = false;
  readonly #config: GoogleTtsConfig;
  readonly #token: () => Promise<string>;

  constructor(config: GoogleTtsConfig) {
    if (!config.projectId) throw new Error('a Google project id is required');
    this.#config = config;
    if (config.token) {
      this.#token = config.token;
    } else {
      const auth = new GoogleAuth({ scopes: SCOPES });
      this.#token = async () => {
        const client = await auth.getClient();
        const token = await client.getAccessToken();
        if (!token.token) throw new SpeakError('not_configured', 'no ambient credentials');
        return token.token;
      };
    }
  }

  async speak(request: SpeakRequest, signal?: AbortSignal): Promise<SpokenAudio> {
    const problems = speakProblems(request);
    // 投げる前に断れるものは、投げる前に断る
    if (problems.length > 0) throw new SpeakError('invalid_request', problems.join(' / '));

    /*
     * **もう止められているなら、繋ぎに行かない。**
     * 資格情報を取っている間に止められることがあり、
     * そのまま進むと、誰も待っていない読み上げに課金が発生する。
     */
    if (signal?.aborted) throw new SpeakError('cancelled', '読み上げを止めました');

    const doFetch = this.#config.fetch ?? globalThis.fetch;
    const timeout = AbortSignal.timeout(this.#config.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    // 呼び出し側の中止と、時間切れの両方を効かせる
    const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;

    let response: Response;
    try {
      response = await doFetch('https://texttospeech.googleapis.com/v1/text:synthesize', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${await this.#token()}`,
          'x-goog-user-project': this.#config.projectId,
          'content-type': 'application/json',
        },
        signal: combined,
        body: JSON.stringify({
          input: { text: request.text },
          voice: {
            languageCode: request.language,
            ...(request.voice ? { name: request.voice } : {}),
          },
          audioConfig: {
            audioEncoding: 'LINEAR16',
            sampleRateHertz: 16_000,
            ...(request.speakingRate === undefined ? {} : { speakingRate: request.speakingRate }),
          },
        }),
      });
    } catch (error) {
      // 中止と時間切れを混ぜない。利用者にとって別の話。
      if (signal?.aborted) throw new SpeakError('cancelled', '読み上げを止めました');
      throw new SpeakError('timed_out', error instanceof Error ? error.message : String(error));
    }

    const text = await response.text();
    let body: { audioContent?: string; error?: { message?: string } };
    try {
      body = JSON.parse(text) as typeof body;
    } catch {
      throw new SpeakError(
        'provider_error',
        `Google replied with ${response.status} and no readable body`,
      );
    }
    if (!response.ok) {
      throw reasonFor(response.status, body.error?.message ?? `status ${response.status}`);
    }
    if (!body.audioContent) {
      // 空を無音として返さない。読み上げたことにしない。
      throw new SpeakError('provider_error', 'Google returned no audio');
    }

    return {
      bytes: new Uint8Array(Buffer.from(body.audioContent, 'base64')),
      mimeType: 'audio/l16; rate=16000',
      voice: request.voice ?? `${request.language}-default`,
    };
  }
}
