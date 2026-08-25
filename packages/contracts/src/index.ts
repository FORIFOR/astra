/**
 * @astra/contracts
 *
 * 境界を越えるものの一次ソース。Zod スキーマが正本で、TypeScript の型は z.infer で導出する。
 * 手書きの interface を並置しない（実装仕様 §3.1）。
 *
 * 正本:     docs/spec/new_ai_platform_design_spec_v0.1.md
 * 実装仕様: docs/spec/phase-0-implementation-spec.md §3
 */
export * from './version.js';
export * from './uuid.js';
export * from './ids.js';
export * from './primitives.js';
export * from './codec.js';
export * from './errors.js';
export * from './approval.js';
export * from './artifact.js';
export * from './task.js';
export * from './events.js';
export * from './plugin.js';
export * from './identity.js';
export * from './host.js';
export * from './api.js';
