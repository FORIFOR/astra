/**
 * 画像・動画の提供者。正本 §15.1・§15.2。
 *
 * **決まっていないものを、決まったことにしない。**
 * 画像は代役を返し、代役だと名乗る。動画は実装そのものが無いので、
 * 「無い」と答える（無いものを本物として扱わない）。
 */
import { NOT_IMPLEMENTED, type CapabilityInput } from '@astra/contracts';
import { DeterministicImageGenerator, type ImageGenerator } from './image.js';
import { IMAGE_SETTINGS, vertexImageGeneratorFromEnv, type ImagenEnv } from './imagen.js';

export type MediaProviderEnv = ImagenEnv;

/**
 * 画像の生成をどこへ頼むか。**1 箇所で決める。**
 *
 * 選ばれていなければ代役。**名前だけで本物になったことにしない** —
 * `ASTRA_IMAGE_PROVIDER` が置いてあっても、鍵や project が無ければ
 * 呼べないので、代役のまま名乗る。
 */
export function imageGeneratorFromEnv(
  env: MediaProviderEnv,
  provided?: ImageGenerator,
): ImageGenerator {
  return provided ?? vertexImageGeneratorFromEnv(env) ?? new DeterministicImageGenerator();
}

export function imageCapability(generator: ImageGenerator): CapabilityInput {
  return {
    implementation: generator.name,
    isStandIn: generator.isStandIn,
    configureWith: generator.isStandIn ? IMAGE_SETTINGS : null,
  };
}

/**
 * 動画（正本 §15.2）。
 *
 * **段取りはある。生成の先が無い。**
 * 構成・字幕・読み上げ原稿・書き出しの列は動くが、
 * text/image-to-video のモデルが未決（OQ-19）なので書き出せない。
 *
 * 代役を置かないのは、置くと「動くが中身が無い」映像が Library に残り、
 * あとから本物と見分けられなくなるため。無いことを、無いと答える。
 */
export function videoCapability(renderer?: { name: string }): CapabilityInput {
  if (renderer) {
    return { implementation: renderer.name, isStandIn: false, configureWith: null };
  }
  return NOT_IMPLEMENTED('映像の生成（正本 §15.2・OQ-19）。段取りは動くが、書き出しの先が無い');
}
