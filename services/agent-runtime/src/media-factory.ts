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
 * 動画（正本 §15.2）。**まだ実装が無い。**
 *
 * 代役すら置いていないのは、置くと「動くが中身が無い」ものが
 * Library に残るため。無いことを、無いと答える。
 */
export function videoCapability(): CapabilityInput {
  return NOT_IMPLEMENTED('動画エージェント（正本 §15.2）はまだ実装がありません');
}
