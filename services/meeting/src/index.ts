/**
 * @astra/service-meeting
 *
 * 会議のセッション、STT の取り回し、翻訳、finalize。正本 §11・§12・§13。
 * 実装仕様: docs/spec/phase-3-implementation-spec.md
 */
export {
  ScriptedBatchTranscriber,
  ScriptedStreamingTranscriber,
  EchoTranslationProvider,
  FailingStreamingTranscriber,
  type BatchTranscriber,
  type ScriptLine,
  type StreamingConfig,
  type StreamingSession,
  type StreamingTranscriber,
  type TranscriptResult,
  type TranslationProvider,
} from './providers.js';
export {
  alignSpeakers,
  overlapMs,
  stabilize,
  supersededBy,
  type StableSegment,
  type TimedSegment,
} from './stabilize.js';
export {
  MeetingService,
  parseBundle,
  type MeetingDeps,
  type StartMeetingInput,
} from './service.js';
export {
  KeywordSummarizer,
  durationMs,
  speakerCount,
  withCitations,
  type MeetingSummarizer,
  type SummaryDraft,
} from './summarize.js';
export {
  meetingExecutors,
  renderBundle,
  type MeetingExecutorDeps,
  type MeetingExecutorResult,
} from './executor.js';
export { FsRecordingStore, MemoryRecordingStore, type RecordingStore } from './recording.js';
export { AnthropicSummarizer, type AnthropicSummarizerConfig } from './anthropic.js';
export {
  GoogleBatchTranscriber,
  GoogleStreamingTranscriber,
  durationToMs,
  fromV1Response,
  fromV2Results,
  type GoogleBatchConfig,
  type GoogleStreamingConfig,
  type V1SpeechClient,
  type V2SpeechClient,
  GoogleTranslationProvider,
  baseLanguage,
  type GoogleTranslationConfig,
  type TranslateClient,
} from './google.js';
export {
  assertNoStandIns,
  meetingProvidersFromEnv,
  standIns,
  type MeetingProviderEnv,
  type MeetingProviders,
} from './factory.js';
export { meetingDataSources } from './data-sources.js';
export {
  speechV2ClientFromEnv,
  translateClientFromEnv,
  type GoogleRestConfig,
} from './google-rest.js';
export * from './google-streaming.js';
export { GoogleTtsProvider, type GoogleTtsConfig } from './google-tts.js';
