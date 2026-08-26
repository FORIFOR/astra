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

/**
 * データがどこまで出るか。UI/UX §22
 * 「local-only / cloud-used / external-send を短い human-readable label で
 * 表示可能にする」。
 *
 * **surface（どこで動くか）と handling（どこまで出るか）は別物。**
 * cloud で動く tool でも、外へ送らないものは external-send ではない。
 * ここを一緒にすると、「送っていないのに送ったと言う」か、
 * その逆が起きる。
 */
export const DATA_HANDLING = ['local_only', 'cloud_used', 'external_send'] as const;
export const DataHandling = z.enum(DATA_HANDLING);
export type DataHandling = z.infer<typeof DataHandling>;

/** §22 が求める「短い human-readable label」。 */
export const DATA_HANDLING_LABEL: Readonly<Record<DataHandling, string>> = {
  local_only: '手元だけ',
  cloud_used: 'クラウドで処理',
  external_send: '外部へ送信',
};

/** もう一段だけ開く説明。モデルの内部推論は出さない（§5.2 と同じ扱い）。 */
export const DATA_HANDLING_DETAIL: Readonly<Record<DataHandling, string>> = {
  local_only: 'この端末の中だけで処理します。外には出ません。',
  cloud_used: 'Astra のクラウドで処理します。ほかのサービスへは送りません。',
  external_send: 'ほかのサービスへ送ります。送る前に確認します。',
};

/**
 * 実行の場所と risk から、どこまで出るかを決める。
 *
 * **推測しない。**local で動くなら手元だけ。cloud なら少なくとも
 * クラウドは使う。外部への確定操作だけが external-send。
 */
export function dataHandlingFor(surface: ExecutionSurface, risk: ActionRisk): DataHandling {
  // 外部への確定操作は、どこで動いていても「外部へ送信」
  if (risk === 'EXTERNAL_COMMIT' || risk === 'FINANCIAL') return 'external_send';
  return surface === 'local' ? 'local_only' : 'cloud_used';
}
