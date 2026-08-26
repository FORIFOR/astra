/**
 * 実行の場所と、確認が要る risk。正本 §2.4・§9.2。
 *
 * plugin と mcp の両方が要るので、どちらからも独立させてある。
 * ここに置かないと plugin.ts ↔ mcp.ts が循環する。
 */
import { z } from 'zod';
import type { ActionRisk } from './approval.js';

export const ExecutionSurface = z.enum(['local', 'cloud']);
export type ExecutionSurface = z.infer<typeof ExecutionSurface>;

/** 正本 §9.2。これらは確認なしに実行しない。 */
export const CONFIRMATION_REQUIRED_RISKS = [
  'EXTERNAL_COMMIT',
  'DESTRUCTIVE',
  'REGULATED',
  'FINANCIAL',
] as const satisfies readonly ActionRisk[];
