/**
 * 起動時に「何が本物で、何が代役か」を答える。正本 §21・§25。
 *
 * **1 箇所で組む。**gateway と worker が別々に数えると、
 * 片方だけ新しい能力を見落とす。
 */
import {
  buildCapabilityReport,
  type CapabilityInput,
  type CapabilityReport,
  type ExternalCapability,
} from '@astra/contracts';
import {
  DeterministicImageGenerator,
  imageCapability,
  videoCapability,
} from '@astra/service-agent-runtime';
import { unconfiguredProviders, type OauthEnv } from '@astra/oauth';
import type { MeetingProviders } from '@astra/service-meeting';
import type { ResearchProviders } from '@astra/service-research';

/** 名前を持たない提供者もある。無ければ既定の呼び名を使う。 */
function fromProvider(
  provider: { name?: string; isStandIn: boolean },
  fallbackName: string,
  configureWith: string,
): CapabilityInput {
  return {
    implementation: provider.name ?? fallbackName,
    isStandIn: provider.isStandIn,
    configureWith: provider.isStandIn ? configureWith : null,
  };
}

/** 繋げる提供者が 1 つも無ければ、connector は使えない。 */
function oauthCapability(env: OauthEnv): CapabilityInput {
  const missing = unconfiguredProviders(env);
  if (missing.length === 0) {
    return { implementation: 'configured', isStandIn: false, configureWith: null };
  }
  return {
    implementation: `unconfigured: ${missing.map((m) => m.provider).join(', ')}`,
    isStandIn: true,
    configureWith: missing.map((m) => m.setting).join(', '),
  };
}

export function capabilityReport(input: {
  research: ResearchProviders;
  meeting: MeetingProviders;
  env: OauthEnv;
}): CapabilityReport {
  const inputs: Record<ExternalCapability, CapabilityInput> = {
    search: fromProvider(input.research.search, 'search', 'ASTRA_SEARCH_PROVIDER（OQ-3 未決）'),
    language_model: fromProvider(input.research.model, 'language model', 'ANTHROPIC_API_KEY'),
    speech_to_text: fromProvider(
      input.meeting.streaming,
      'streaming transcriber',
      'GOOGLE_STT_RECOGNIZER',
    ),
    translation: fromProvider(input.meeting.translation, 'translation', 'GOOGLE_TRANSLATE_PARENT'),
    // 画像は代役の実装がある。動画は段取りだけがあり、生成の先が無い。
    image_generation: imageCapability(new DeterministicImageGenerator()),
    video_generation: videoCapability(),
    oauth_providers: oauthCapability(input.env),
    // 任意。無くても本番は起動する（§27 の再利用候補で、製品の必須ではない）
    text_to_speech: input.env['GOOGLE_CLOUD_PROJECT']
      ? { implementation: 'google-tts', isStandIn: false, configureWith: null }
      : {
          implementation: 'none',
          isStandIn: true,
          configureWith: 'GOOGLE_CLOUD_PROJECT',
        },
  };
  return buildCapabilityReport(inputs);
}
