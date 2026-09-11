/**
 * 実際に許された scope を、cloud の接続記録から読む。正本 §21。
 *
 * これまで `ASTRA_GRANTED_SCOPES`（環境変数）だけが許可の出所で、**誰も書いていなかった**
 * （[[declared-not-enforced]] の型）。繋いだ事実は gateway の `connector_connections` に
 * 「実際に許された provider scope」として残っているので、そこから Astra の許可へ写す。
 * 環境変数は harness の上書きとして残す（足す方向にだけ）。
 */
import {
  permissionsFromGoogleScopes,
  permissionsFromMicrosoftScopes,
} from '@astra/service-connectors';
import { CONNECTORS } from './connector-steps.js';

export interface ConnectionRecord {
  readonly pluginId: string;
  readonly connectorId: string;
  readonly provider: string;
  readonly state: string;
  readonly grantedScopes: readonly string[];
}

/** 接続記録（生きているものだけ）→ plugin ごとの Astra の許可。 */
export function grantsFromConnections(
  items: readonly ConnectionRecord[],
): Record<string, string[]> {
  const out: Record<string, Set<string>> = {};
  for (const c of items) {
    if (c.state !== 'CONNECTED') continue;
    const granted = c.grantedScopes.join(' ');
    const permissions =
      c.provider === 'google'
        ? permissionsFromGoogleScopes(granted)
        : c.provider === 'microsoft'
          ? permissionsFromMicrosoftScopes(granted)
          : [];
    const set = (out[c.pluginId] ??= new Set());
    for (const p of permissions) set.add(p);
  }
  return Object.fromEntries(Object.entries(out).map(([k, v]) => [k, [...v].sort()]));
}

/** 環境変数の上書きを**足す**（減らさない。減らすのは接続を切ること）。 */
export function mergeGrants(
  base: Record<string, string[]>,
  override: Record<string, string[]>,
): Record<string, string[]> {
  const out: Record<string, string[]> = { ...base };
  for (const [plugin, scopes] of Object.entries(override)) {
    out[plugin] = [...new Set([...(out[plugin] ?? []), ...scopes])].sort();
  }
  return out;
}

/** この端末が知っている plugin（接続記録を取りに行く先）。 */
export function knownPluginIds(): string[] {
  return [...new Set(Object.values(CONNECTORS).map((c) => c.pluginId))];
}
