/**
 * @astra/service-context
 *
 * Context Engine。正本 §6。**raw なローカルデータをそのまま外へ出さない。**
 * 実装仕様: docs/spec/phase-7-implementation-spec.md
 */
export {
  buildCapsule,
  containsRawLocalData,
  decideEgress,
  highestSensitivity,
  type CapsuleInput,
  type EgressDecision,
  type LocalSignals,
} from './capsule.js';
