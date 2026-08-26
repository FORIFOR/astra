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
