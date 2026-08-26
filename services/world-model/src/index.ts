/**
 * @astra/service-world-model
 *
 * 「ユーザーの世界の現在状態」。正本 §10。
 * 実装仕様: docs/spec/phase-6-implementation-spec.md
 */
export { WorldModelService, type RememberResult, type WorldDeps } from './service.js';
export {
  MIN_CONFIDENCE,
  MIN_STATEMENT_LENGTH,
  shouldRemember,
  type MemoryCandidate,
  type MemoryVerdict,
} from './memory.js';
export { buildBrief, type BriefInput, type MeetingLike, type TaskLike } from './brief.js';
