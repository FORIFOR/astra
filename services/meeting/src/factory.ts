/**
 * 環境変数からプロバイダを組み立てる。Phase 3 実装仕様 §1.1（OQ-11）。
 *
 * **決まっていないことを、決まったふりで埋めない。**
 * 設定が無ければ代役を返し、代役であることを `isStandIn` で名乗る。
 * 本番で代役のまま起動させない判断は、呼び出し側が `isStandIn` を見て行う。
 *
 * Google のクライアントは**動的に読み込む**。認証情報が決まるまで
 * 全員に重い依存を背負わせない。
 */
import {
  EchoTranslationProvider,
  ScriptedBatchTranscriber,
  ScriptedStreamingTranscriber,
  type BatchTranscriber,
  type StreamingTranscriber,
  type TranslationProvider,
} from './providers.js';
import { AnthropicSummarizer } from './anthropic.js';
import { KeywordSummarizer, type MeetingSummarizer } from './summarize.js';

export interface MeetingProviders {
  readonly streaming: StreamingTranscriber;
  readonly batch: BatchTranscriber;
  readonly translation: TranslationProvider;
  readonly summarizer: MeetingSummarizer;
}

/** 代役が混ざっていれば、その名前を返す。空なら全部本物。 */
export function standIns(providers: MeetingProviders): string[] {
  return [
    providers.streaming.isStandIn ? 'streaming transcriber' : null,
    providers.batch.isStandIn ? 'batch transcriber' : null,
    providers.translation.isStandIn ? 'translation' : null,
    providers.summarizer.isStandIn ? 'summarizer' : null,
  ].filter((name): name is string => name !== null);
}

/**
 * 本番で代役のまま起動していないか確かめる。
 *
 * **何が代役なのかを名指しで言う。**「providers are stand-ins」とだけ
 * 言われても、どれを埋めればよいか分からない。
 * 本番以外では警告を返すだけで、開発を止めない。
 */
export function assertNoStandIns(
  remaining: readonly string[],
  env: string,
): { warn: string | null } {
  if (remaining.length === 0) return { warn: null };
  const list = remaining.join(', ');
  if (env === 'production') {
    throw new Error(
      `these providers are still stand-ins: ${list}. Configure them before running in production.`,
    );
  }
  return { warn: `running with stand-in providers: ${list}` };
}

export interface MeetingProviderEnv {
  readonly ANTHROPIC_API_KEY?: string | undefined;
  readonly ASTRA_SUMMARY_MODEL?: string | undefined;
  /** `projects/<id>/locations/<loc>/recognizers/_` */
  readonly GOOGLE_STT_RECOGNIZER?: string | undefined;
  /** `projects/<id>/locations/<loc>` */
  readonly GOOGLE_TRANSLATE_PARENT?: string | undefined;
}

/**
 * 設定されたものだけ本物にする。
 *
 * Google のクライアント生成は呼び出し側から渡す。`@google-cloud/*` を
 * ここで import すると、STT を使わない構成にも依存が乗る。
 */
export async function meetingProvidersFromEnv(
  env: MeetingProviderEnv,
  clients?: {
    speechV1?: () => Promise<import('./google.js').V1SpeechClient>;
    speechV2?: () => Promise<import('./google.js').V2SpeechClient>;
    translate?: () => Promise<import('./google.js').TranslateClient>;
  },
): Promise<MeetingProviders> {
  const { GoogleBatchTranscriber, GoogleStreamingTranscriber, GoogleTranslationProvider } =
    await import('./google.js');

  const streaming: StreamingTranscriber = clients?.speechV1
    ? new GoogleStreamingTranscriber({ client: await clients.speechV1() })
    : new ScriptedStreamingTranscriber([]);

  const batch: BatchTranscriber =
    clients?.speechV2 && env.GOOGLE_STT_RECOGNIZER
      ? new GoogleBatchTranscriber({
          client: await clients.speechV2(),
          recognizer: env.GOOGLE_STT_RECOGNIZER,
        })
      : new ScriptedBatchTranscriber([]);

  const translation: TranslationProvider =
    clients?.translate && env.GOOGLE_TRANSLATE_PARENT
      ? new GoogleTranslationProvider({
          client: await clients.translate(),
          parent: env.GOOGLE_TRANSLATE_PARENT,
        })
      : new EchoTranslationProvider();

  const summarizer: MeetingSummarizer = env.ANTHROPIC_API_KEY
    ? new AnthropicSummarizer({
        apiKey: env.ANTHROPIC_API_KEY,
        ...(env.ASTRA_SUMMARY_MODEL ? { model: env.ASTRA_SUMMARY_MODEL } : {}),
      })
    : new KeywordSummarizer();

  return { streaming, batch, translation, summarizer };
}
