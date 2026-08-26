/**
 * @astra/stt
 *
 * Task Dock の音声入力。正本 §11.1。
 * **音を勝手にクラウドへ出さない**のが、この package の存在理由。
 */
export {
  Vad,
  frameStats,
  SAMPLE_RATE_HZ,
  type VadEvent,
  type VadOptions,
  type VadState,
} from './vad.js';
export {
  ScriptedCloudCorrector,
  ScriptedSttProvider,
  type SttConfig,
  type SttResult,
  type SttSession,
  type StreamingSttProvider,
} from './provider.js';
export {
  Dictation,
  DEFAULT_CORRECTION_THRESHOLD,
  lowestConfidence,
  type DictationEvents,
  type DictationOptions,
} from './dictation.js';
export {
  MeasurementRecorder,
  MARK_TO_SLO,
  STT_MARKS,
  canMeetFirstPartial,
  elapsedBetween,
  firstPartialFloorMs,
  measurementProblems,
  type MeasurementProblem,
  type SttMark,
  type SttMeasurement,
} from './measurement.js';
