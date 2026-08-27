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
import { configuredProviders, unconfiguredProviders, type OauthEnv } from '@astra/oauth';
import type { MeetingProviders } from '@astra/service-meeting';
import { SEARCH_SETTINGS, type ResearchProviders } from '@astra/service-research';

/**
 * 名前を持たない提供者もある。無ければ既定の呼び名を使う。
 *
 * `verified` は**実測の記録がある実装だけ**が名乗る（`docs/evidence/`）。
 * 名乗らせる根拠を `VERIFIED_IMPLEMENTATIONS` に置いてあるので、
 * 実装を差し替えたら、確かめ直すまで `unverified` に戻る。
 */
function fromProvider(
  provider: { name?: string; isStandIn: boolean },
  fallbackName: string,
  configureWith: string,
): CapabilityInput {
  const implementation = provider.name ?? fallbackName;
  return {
    implementation,
    isStandIn: provider.isStandIn,
    configureWith: provider.isStandIn ? configureWith : null,
    ...(provider.isStandIn
      ? {}
      : { verification: VERIFIED_IMPLEMENTATIONS.has(implementation) ? 'verified' : 'unverified' }),
  };
}

/**
 * 実際に繋いで結果を見た実装。**記録があるものだけ。**
 *
 * `docs/evidence/` の測定に対応する。ここに名前を足すのは、
 * 「動くはず」ではなく「動いた」を書き足すことなので、
 * 実測の記録を伴わない追加はしない。
 *
 * **書き足しただけで verified になる。**それが危ういので、
 * 「この一覧の全ての名前が evidence に現れること」を試験で見張る
 * （`services/capabilities/test/report.test.ts`）。
 * 見張らないと、この一覧はいずれ願望の置き場になる。
 */
export const VERIFIED_IMPLEMENTATIONS = new Set([
  // docs/evidence/stt-google.md
  'google-stt-v2',
  'google-stt-batch',
  'google-translate-v3',
  // docs/evidence/language-model-byok.md
  'device (bring your own)',
  // docs/evidence/research-search.md
  'device (web search)',
  // docs/evidence/stt-google.md（TTS の節）
  'google-tts',
]);

/**
 * 繋げる提供者が 1 つも無ければ、connector は使えない。
 *
 * **全部揃うことを求めない。**Google だけ設定してある構成は普通にあり、
 * そこで「接続できません」と答えるのは嘘になる。ただし
 * **繋げない提供者の名前は残す** — 「Microsoft も繋がるはず」と
 * 思ったまま使われないように。
 */
function oauthCapability(env: OauthEnv, connected: boolean): CapabilityInput {
  const ready = configuredProviders(env);
  const missing = unconfiguredProviders(env);
  if (ready.length === 0) {
    return {
      implementation: 'none configured',
      isStandIn: true,
      configureWith: missing.map((m) => m.setting).join(', '),
    };
  }
  return {
    implementation:
      missing.length === 0
        ? `configured: ${ready.join(', ')}`
        : `configured: ${ready.join(', ')} / unavailable: ${missing.map((m) => m.provider).join(', ')}`,
    isStandIn: false,
    configureWith: null,
    /*
     * **一覧に名前を書いて verified にはできない。**
     *
     * 接続は利用者ごとに違うので、実装の名前で「確かめた」とは言えない。
     * 言えるのは「実際に繋がっている接続が 1 つでもあるか」だけ。
     * 繋がっていれば、同意画面も、コードの交換も、保管も通っている。
     *
     * ここを一覧に入れると、**誰も繋いでいない環境でも verified になる。**
     */
    verification: connected ? 'verified' : 'unverified',
  };
}

export function capabilityReport(input: {
  research: ResearchProviders;
  meeting: MeetingProviders;
  env: OauthEnv;
  /**
   * 見て分かること。**設定ではなく、実際に起きたこと。**
   *
   * いまは接続の有無だけ。設定が正しいかは設定を見ても分からないので、
   * 「繋がった実績があるか」を見る。
   */
  observed?: { readonly oauthConnected?: boolean };
}): CapabilityReport {
  const inputs: Record<ExternalCapability, CapabilityInput> = {
    // どの検索を使うかは利用者が選ぶ。**設定名まで言う。**
    search: fromProvider(input.research.search, 'search', SEARCH_SETTINGS),
    /*
     * 言語モデル。正本 §21、UI/UX §22。
     *
     * **Astra が共通のキーを持っていないことは、欠落ではない。**
     * 端末で呼ぶ構成（BYOK / Claude Code）は本物であって、代役ではない。
     * `isStandIn` は提供者自身が答える — ここで環境変数の有無から
     * 推し量ると、端末で動いている構成を「未設定」と呼ぶことになる。
     */
    language_model: fromProvider(
      input.research.model,
      'language model',
      'Claude Code を繋ぐか、お使いの API キーを登録してください',
    ),
    speech_to_text: fromProvider(input.meeting.streaming, 'streaming', 'GOOGLE_STT_RECOGNIZER'),
    translation: fromProvider(input.meeting.translation, 'translation', 'GOOGLE_TRANSLATE_PARENT'),
    // 画像は代役の実装がある。動画は段取りだけがあり、生成の先が無い。
    image_generation: imageCapability(new DeterministicImageGenerator()),
    video_generation: videoCapability(),
    oauth_providers: oauthCapability(input.env, input.observed?.oauthConnected === true),
    // 任意。無くても本番は起動する（§27 の再利用候補で、製品の必須ではない）
    text_to_speech: input.env['GOOGLE_CLOUD_PROJECT']
      ? {
          implementation: 'google-tts',
          isStandIn: false,
          configureWith: null,
          // docs/evidence/stt-google.md で実測してある
          verification: 'verified',
        }
      : {
          implementation: 'none',
          isStandIn: true,
          configureWith: 'GOOGLE_CLOUD_PROJECT',
          verification: 'not_configured',
        },
  };
  return buildCapabilityReport(inputs);
}

/**
 * 名乗りを 1 行にする。正本 §25。
 *
 * **1 行にするのは、読めるようにするため。**入れ子の構造で出すと、
 * ログの整形設定によって形が変わり、二つのプロセスの名乗りを
 * 突き合わせられなくなる（実際、突き合わせに失敗した）。
 *
 * 形: `search=stand-in:static language_model=real:device`
 */
export function capabilitySummary(report: CapabilityReport): string {
  return report.items
    .map(
      (item) =>
        `${item.capability}=${item.isStandIn ? 'stand-in' : 'real'}:${item.verification}:${item.implementation}`,
    )
    .join(' ');
}
