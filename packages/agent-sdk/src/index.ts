/**
 * @astra/agent-sdk
 *
 * Agent Package を書くための道具。正本 §14。
 * **宣言どうしの食い違いを、publish まで持っていかない**のが役目。
 */
export {
  build,
  buildEvaluations,
  review,
  type AgentSpec,
  type BuiltPackage,
  type PackageDraft,
  type Problem,
  type ToolSpec,
  type WorkflowStepSpec,
} from './author.js';
