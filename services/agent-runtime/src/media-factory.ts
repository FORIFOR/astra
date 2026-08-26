/**
 * 画像・動画の提供者。正本 §15.1・§15.2。
 *
 * **決まっていないものを、決まったことにしない。**
 * 画像は代役を返し、代役だと名乗る。動画は実装そのものが無いので、
 * 「無い」と答える（無いものを本物として扱わない）。
 */
import { NOT_IMPLEMENTED, type CapabilityInput } from '@astra/contracts';
import { DeterministicImageGenerator, type ImageGenerator } from './image.js';

export interface MediaProviderEnv {
  /** 画像生成の提供者。決まったらここへ実装を渡す（OQ-19）。 */
  readonly ASTRA_IMAGE_PROVIDER?: string | undefined;
}

export function imageGeneratorFromEnv(
  env: MediaProviderEnv,
  provided?: ImageGenerator,
): ImageGenerator {
  // 設定名だけあって実装が無いなら、代役のまま。**名前で本物になったことにしない。**
  if (provided) return provided;
  void env;
  return new DeterministicImageGenerator();
}

export function imageCapability(generator: ImageGenerator): CapabilityInput {
  return {
    implementation: generator.name,
    isStandIn: generator.isStandIn,
    configureWith: generator.isStandIn ? 'ASTRA_IMAGE_PROVIDER（OQ-19 未決）' : null,
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
