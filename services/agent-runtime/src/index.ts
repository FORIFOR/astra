/**
 * @astra/service-agent-runtime
 *
 * Skill / tool / domain entity と、専業 Agent の土台。
 * 正本 §14・§15、実装仕様: docs/spec/phase-5-implementation-spec.md
 */
export { DomainService, type CreateEntityInput, type DomainDeps } from './domain.js';
export {
  SALES_CRM_ENTITIES,
  nextBestActions,
  pipelineSummary,
  type NextBestAction,
  type PipelineStage,
} from './sales-crm.js';
export {
  architectureDataSources,
  careDataSources,
  ehrDataSources,
  salesCrmDataSources,
  stockDataSources,
  videoDataSources,
} from './data-sources.js';
export { entityDefinitions, type AssetReader } from './definitions.js';
export {
  DeterministicImageGenerator,
  ImageService,
  MAX_IMAGE_BYTES,
  titleFor,
  type GenerateImageRequest,
  type GeneratedImage,
  type ImageGenerator,
  type ImageServiceDeps,
} from './image.js';
export * from './media-factory.js';
export * from './video.js';
export * from './video-executor.js';
export * from './care.js';
export * from './care-executor.js';
export * from './ehr.js';
export * from './ehr-executor.js';
export * from './architecture.js';
export * from './architecture-executor.js';
export * from './stock.js';
export * from './stock-executor.js';
export * from './imagen.js';
export * from './sales-crm-executor.js';
