/**
 * Vertex Imagen。正本 §15.1（OQ-19）。
 *
 * 見るのは:
 *   - **空の画像を作らない**
 *   - 断られた理由を種類ごとに分ける（安全側の拒否と、設定の不足は別）
 *   - 選ばれていないものを勝手に使わない
 */
import { describe, expect, it } from 'vitest';
import { DeterministicImageGenerator } from '../src/image.js';
import { imageCapability, imageGeneratorFromEnv } from '../src/media-factory.js';
import {
  ImagenError,
  ImagenGenerator,
  aspectRatioFor,
  vertexImageGeneratorFromEnv,
} from '../src/imagen.js';

const PNG = 'iVBORw0KGgo=';

function respond(
  body: unknown,
  status = 200,
): {
  fetch: typeof globalThis.fetch;
  calls: { url: string; body: unknown }[];
} {
  const calls: { url: string; body: unknown }[] = [];
  const fetch = (async (url: string, init: RequestInit) => {
    calls.push({ url, body: init.body ? JSON.parse(init.body as string) : undefined });
    return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status });
  }) as unknown as typeof globalThis.fetch;
  return { fetch, calls };
}

const generator = (fetch: typeof globalThis.fetch): ImagenGenerator =>
  new ImagenGenerator({ projectId: 'p', fetch, token: async () => 't' });

describe('choosing an image provider', () => {
  it('stays a stand-in when nothing was chosen', () => {
    // 名前だけで本物になったことにしない
    expect(imageGeneratorFromEnv({}).isStandIn).toBe(true);
    expect(imageGeneratorFromEnv({ GOOGLE_CLOUD_PROJECT: 'p' }).isStandIn).toBe(true);
  });

  it('stays a stand-in when the chosen one has no project', () => {
    expect(vertexImageGeneratorFromEnv({ ASTRA_IMAGE_PROVIDER: 'vertex' })).toBeNull();
  });

  it('becomes real once it is chosen and configured', () => {
    const chosen = imageGeneratorFromEnv({
      ASTRA_IMAGE_PROVIDER: 'vertex',
      GOOGLE_CLOUD_PROJECT: 'p',
    });
    expect(chosen.isStandIn).toBe(false);
    expect(chosen.name).toBe('vertex-imagen');
  });

  it('names what to configure while it is a stand-in', () => {
    const capability = imageCapability(new DeterministicImageGenerator());
    expect(capability.isStandIn).toBe(true);
    expect(capability.configureWith).toContain('ASTRA_IMAGE_PROVIDER');
    expect(capability.configureWith).toContain('GOOGLE_CLOUD_PROJECT');
  });
});

describe('generating', () => {
  it('returns the bytes the provider sent', async () => {
    const { fetch, calls } = respond({
      predictions: [{ bytesBase64Encoded: PNG, mimeType: 'image/png' }],
    });
    const image = await generator(fetch).generate({ prompt: '青い傘', seed: 7 });

    expect(image.mimeType).toBe('image/png');
    expect(image.bytes.length).toBeGreaterThan(0);
    expect(image.seed).toBe(7);
    expect(calls[0]!.body).toMatchObject({ instances: [{ prompt: '青い傘' }] });
  });

  it('does not claim a seed it was never given', async () => {
    const { fetch } = respond({ predictions: [{ bytesBase64Encoded: PNG }] });
    const image = await generator(fetch).generate({ prompt: 'x' });
    // 0 を返すと「種 0 で再現できる」と読める
    expect(image.seed).toBe(-1);
  });

  it('says it could not draw this, rather than returning an empty image', async () => {
    // 安全側で断られると 200 で絵が無い返事になる
    const { fetch } = respond({ predictions: [] });
    await expect(generator(fetch).generate({ prompt: 'x' })).rejects.toMatchObject({
      reason: 'refused',
    });
  });

  it('refuses to draw nothing', async () => {
    const { fetch, calls } = respond({});
    await expect(generator(fetch).generate({ prompt: '   ' })).rejects.toBeInstanceOf(ImagenError);
    expect(calls).toEqual([]);
  });

  it('tells "not enabled" apart from "not allowed"', async () => {
    const disabled = respond(
      { error: { message: 'Vertex AI API has not been used in project 1 before' } },
      403,
    );
    await expect(generator(disabled.fetch).generate({ prompt: 'x' })).rejects.toMatchObject({
      reason: 'not_configured',
    });

    const denied = respond({ error: { message: 'caller lacks permission' } }, 403);
    await expect(generator(denied.fetch).generate({ prompt: 'x' })).rejects.toMatchObject({
      reason: 'permission_denied',
    });
  });

  it('names the other failures too', async () => {
    for (const [status, body, reason] of [
      [429, {}, 'rate_limited'],
      [400, { error: { message: 'blocked by safety filters' } }, 'refused'],
      [500, {}, 'provider_error'],
    ] as const) {
      const { fetch } = respond(body, status);
      await expect(generator(fetch).generate({ prompt: 'x' })).rejects.toMatchObject({ reason });
    }
  });

  it('does not read an unreadable reply as a picture', async () => {
    const { fetch } = respond('<html>error</html>');
    await expect(generator(fetch).generate({ prompt: 'x' })).rejects.toMatchObject({
      reason: 'provider_error',
    });
  });
});

describe('sizes', () => {
  it('picks the nearest ratio the provider actually supports', () => {
    expect(aspectRatioFor(1024, 1024)).toBe('1:1');
    expect(aspectRatioFor(1920, 1080)).toBe('16:9');
    expect(aspectRatioFor(1080, 1920)).toBe('9:16');
    expect(aspectRatioFor(800, 600)).toBe('4:3');
    // 任意の寸法を作れるふりをしない
    expect(aspectRatioFor(1000, 999)).toBe('1:1');
  });

  it('falls back to square when no size was asked for', () => {
    expect(aspectRatioFor(undefined, undefined)).toBe('1:1');
  });
});
