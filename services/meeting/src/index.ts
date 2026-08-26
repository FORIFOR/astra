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
