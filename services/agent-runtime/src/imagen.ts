/**
 * Vertex AI Imagen を `ImageGenerator` として使う。正本 §15.1（OQ-19）。
 *
 * SDK ではなく **REST + ADC**。会議まわりの Google 接続と同じ理由:
 * 使う endpoint は 1 つなので、依存を足す割に合わない。
 * **鍵ファイルをリポジトリへ置かない**（§21）。
 *
 * ここが守ること:
 *   - **絵が返らなかったら、絵が返らなかったと言う。**空の画像を作らない
 *   - 断られた理由を種類ごとに分ける（安全側の拒否と、設定の不足は別）
 */
import { AstraError } from '@astra/contracts';
import {
  MAX_IMAGE_BYTES,
  type GenerateImageRequest,
  type GeneratedImage,
  type ImageGenerator,
} from './image.js';

/** ADC が要求する scope。**これ以上を求めない。** */
const SCOPES = ['https://www.googleapis.com/auth/cloud-platform'];

const DEFAULT_MODEL = 'imagen-4.0-generate-001';
const DEFAULT_LOCATION = 'us-central1';

export interface ImagenConfig {
  readonly projectId: string;
  readonly location?: string;
  readonly model?: string;
  readonly fetch?: typeof globalThis.fetch;
  /** access token を返すもの。省略で ADC。 */
  readonly token?: () => Promise<string>;
  readonly timeoutMs?: number;
}

/** 断られた理由。**「なんとなく失敗」にしない。** */
export const IMAGEN_FAILURES = [
  'not_configured',
  'permission_denied',
  'rate_limited',
  'refused',
  'no_image',
  'too_large',
  'provider_error',
] as const;
export type ImagenFailure = (typeof IMAGEN_FAILURES)[number];

export const IMAGEN_RECOVERY: Readonly<Record<ImagenFailure, string>> = {
  not_configured: '画像の生成が設定されていません。',
  permission_denied: '画像の生成を使う権限がありません。',
  rate_limited: '画像の生成が混み合っています。少し待って試してください。',
  // 安全側の拒否。設定を直しても通らない。
  refused: 'この内容では画像を作れませんでした。',
  no_image: '画像が返りませんでした。',
  too_large: '画像が大きすぎました。',
  provider_error: '画像の生成で問題が起きました。',
};

export class ImagenError extends Error {
  readonly reason: ImagenFailure;
  constructor(reason: ImagenFailure, message?: string) {
    super(message ?? IMAGEN_RECOVERY[reason]);
    this.name = 'ImagenError';
    this.reason = reason;
  }
}

/** 縦横比。Imagen は寸法ではなく比で受け取る。 */
export function aspectRatioFor(width: number | undefined, height: number | undefined): string {
  if (!width || !height) return '1:1';
  const ratio = width / height;
  // 近いものへ寄せる。**任意の寸法を作れるふりをしない。**
  const candidates: [string, number][] = [
    ['1:1', 1],
    ['3:4', 3 / 4],
    ['4:3', 4 / 3],
    ['9:16', 9 / 16],
    ['16:9', 16 / 9],
  ];
  let best = candidates[0]!;
  for (const candidate of candidates) {
    if (Math.abs(candidate[1] - ratio) < Math.abs(best[1] - ratio)) best = candidate;
  }
  return best[0];
}

export class ImagenGenerator implements ImageGenerator {
  readonly name = 'vertex-imagen';
  /** 代役ではない。**本物のモデルを呼んでいる。** */
  readonly isStandIn = false;

  readonly #config: ImagenConfig;
  readonly #token: () => Promise<string>;

  constructor(config: ImagenConfig) {
    if (!config.projectId) {
      throw new AstraError('common.validation_failed', 'imagen needs a project id');
    }
    this.#config = config;
    this.#token = config.token ?? adcToken();
  }

  async generate(request: GenerateImageRequest): Promise<GeneratedImage> {
    if (!request.prompt.trim()) {
      throw new ImagenError('provider_error', 'an image needs something to draw');
    }

    const location = this.#config.location ?? DEFAULT_LOCATION;
    const model = this.#config.model ?? DEFAULT_MODEL;
    const url =
      `https://${location}-aiplatform.googleapis.com/v1/projects/${this.#config.projectId}` +
      `/locations/${location}/publishers/google/models/${model}:predict`;

    const doFetch = this.#config.fetch ?? globalThis.fetch;
    let response: Response;
    try {
      response = await doFetch(url, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${await this.#token()}`,
          'content-type': 'application/json',
        },
        signal: AbortSignal.timeout(this.#config.timeoutMs ?? 120_000),
        body: JSON.stringify({
          instances: [{ prompt: request.prompt }],
          parameters: {
            sampleCount: 1,
            aspectRatio: aspectRatioFor(request.width, request.height),
            // 同じ種で同じ絵。再現できないと lineage の意味が薄い。
            ...(request.seed === undefined ? {} : { seed: request.seed }),
          },
        }),
      });
    } catch (error) {
      throw new ImagenError(
        'provider_error',
        error instanceof Error ? error.message : String(error),
      );
    }

    const text = await response.text();
    if (!response.ok) throw failureFor(response.status, text);

    let body: { predictions?: { bytesBase64Encoded?: string; mimeType?: string }[] };
    try {
      body = JSON.parse(text) as typeof body;
    } catch {
      throw new ImagenError('provider_error', 'the provider sent a reply we could not read');
    }

    const first = body.predictions?.[0];
    if (!first?.bytesBase64Encoded) {
      /*
       * 応答は 200 だが絵が無い。**安全側で断られたときにこうなる。**
       * 空の画像を作ると、Library に中身の無いものが残り、
       * あとから本物と見分けられなくなる。
       */
      throw new ImagenError('refused');
    }

    const bytes = decodeBase64(first.bytesBase64Encoded);
    if (bytes.length > MAX_IMAGE_BYTES) throw new ImagenError('too_large');

    return {
      bytes,
      mimeType: first.mimeType ?? 'image/png',
      width: request.width ?? 1024,
      height: request.height ?? 1024,
      // 種を指定しなかったときに 0 を返すと「種 0 で再現できる」と読める。
      seed: request.seed ?? -1,
    };
  }
}

function failureFor(status: number, body: string): ImagenError {
  if (status === 401 || status === 403) {
    // API が有効でないのと、権限が無いのを分ける。直し方が違う。
    return /has not been used|is disabled|SERVICE_DISABLED/i.test(body)
      ? new ImagenError('not_configured')
      : new ImagenError('permission_denied');
  }
  if (status === 429) return new ImagenError('rate_limited');
  if (status === 400 && /safety|blocked|policy/i.test(body)) return new ImagenError('refused');
  return new ImagenError('provider_error', `the provider replied ${String(status)}`);
}

function decodeBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function adcToken(): () => Promise<string> {
  return async () => {
    // 使うときにだけ読み込む。設定されていない構成で依存を要求しない。
    const { GoogleAuth } = await import('google-auth-library');
    const client = await new GoogleAuth({ scopes: SCOPES }).getClient();
    const token = await client.getAccessToken();
    if (!token.token) {
      throw new ImagenError('not_configured', 'no ambient Google credentials were available');
    }
    return token.token;
  };
}

export interface ImagenEnv {
  readonly GOOGLE_CLOUD_PROJECT?: string | undefined;
  readonly ASTRA_IMAGE_PROVIDER?: string | undefined;
  readonly ASTRA_IMAGEN_LOCATION?: string | undefined;
  readonly ASTRA_IMAGEN_MODEL?: string | undefined;
}

export const IMAGE_SETTINGS = 'ASTRA_IMAGE_PROVIDER=vertex と GOOGLE_CLOUD_PROJECT';

/**
 * 設定から Vertex の画像生成を組む。**選ばれていなければ null。**
 *
 * 検索と同じ理由で既定を決めない — 何を描かせたいかが提供者へ渡る。
 */
export function vertexImageGeneratorFromEnv(env: ImagenEnv): ImageGenerator | null {
  if (env.ASTRA_IMAGE_PROVIDER?.trim().toLowerCase() !== 'vertex') return null;
  if (!env.GOOGLE_CLOUD_PROJECT) return null;
  return new ImagenGenerator({
    projectId: env.GOOGLE_CLOUD_PROJECT,
    ...(env.ASTRA_IMAGEN_LOCATION ? { location: env.ASTRA_IMAGEN_LOCATION } : {}),
    ...(env.ASTRA_IMAGEN_MODEL ? { model: env.ASTRA_IMAGEN_MODEL } : {}),
  });
}
