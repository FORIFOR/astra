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
export { extractDeadline, type ExtractedDeadline } from './work/deadline.js';
export {
  pressure,
  rankPressure,
  WEIGHTS,
  DEADLINE_TAU_DAYS,
  type PressureInput,
  type PressureResult,
} from './work/pressure.js';
export {
  buildWorkContext,
  clusterProjects,
  owedItems,
  waitingItems,
  weekLoad,
  personKey,
  titleTokens,
  cleanTitle,
  type BuildInput,
  type ProjectCluster,
} from './work/graph.js';
export {
  deriveProfile,
  applyUpdate,
  EMPTY_PERSONALIZATION,
  type StoredPersonalization,
} from './work/personalization.js';
export {
  classifyContextIntent,
  injectionText,
  RELEVANCE_THRESHOLD,
  selectContextPack,
  selectInjection,
  type ContextPack,
  type InjectionInput,
} from './work/injection.js';
export { ruleSemantic } from './work/semantic.js';
export {
  buildReplyPack,
  renderReplyContext,
  replyBasis,
  replyInstruction,
  resolveReplyTarget,
  REPLY_MATCH_THRESHOLD,
  type ReplyPackInput,
  type ResolveReplyInput,
} from './work/reply.js';
export { buildMeetingBrief, nextEvent, type MeetingBriefInput } from './work/meeting-brief.js';
export { WorkContextService, type WorkContextDeps } from './work/service.js';
