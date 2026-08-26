/**
 * @astra/service-research
 *
 * 計画・検索・突き合わせ・統合と Evidence Ledger。正本 §8。
 */
export { ResearchService, composeReport, type ResearchDeps, type StepOutcome } from './service.js';
export { researchExecutors } from './executor.js';
export {
  AnthropicLanguageModel,
  isGrounded,
  type AnthropicConfig,
  type Fetch,
} from './anthropic.js';
export {
  DeterministicLanguageModel,
  StaticSearchProvider,
  type LanguageModel,
  type SearchProvider,
  type SearchHit,
  type SourceType,
} from './providers.js';
export {
  confidenceOf,
  dedupe,
  findContradictions,
  freshness,
  normalizeClaim,
  normalizeUrl,
  score,
  sourceQuality,
  type Contradiction,
  type ScoredCandidate,
} from './quality.js';
export {
  researchProvidersFromEnv,
  standIns as researchStandIns,
  type ResearchProviderEnv,
  type ResearchProviders,
} from './factory.js';
export { researchDataSources } from './data-sources.js';
