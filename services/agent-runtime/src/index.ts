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
export { salesCrmDataSources } from './data-sources.js';
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
