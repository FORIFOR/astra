/**
 * 規制区分の plugin を、実装していないゲートの上で動かさない。
 * 正本 §22、Phase 5/6 の積み残し。
 *
 * いまの状態:
 *   - compliance **profile** は効いている。規制区分の write は明示承認になり、
 *     参照も監査される（`@astra/policy` の `evaluate`）
 *   - しかし manifest の `policies:` が指す **規則そのものは実行していない**。
 *     publish 時に「ファイルがあること」しか確かめていない
 *
 * 規則が効いていないのに規制 plugin を本番で動かすと、
 * **守っているつもりで守っていない**状態になる。それが一番まずい。
 * 規則エンジンを入れるまでは、本番で明示的に拒む。
 */
import { AstraError, type ComplianceProfile } from '@astra/contracts';

/** 個別 compliance gate を要する profile。正本 §22。 */
const STRICT_PROFILES: readonly ComplianceProfile[] = ['REGULATED_HEALTH', 'CARE', 'FINANCIAL'];

export function isStrictProfile(profile: ComplianceProfile): boolean {
  return STRICT_PROFILES.includes(profile);
}

/**
 * 規則エンジンが入ったら、この関数ごと消す。
 * フラグで無効化できるようにしないのは、フラグが立ったまま忘れられるため。
 */
export function assertPolicyEnforcementAvailable(
  profile: ComplianceProfile,
  env: string,
  pluginId: string,
): void {
  if (env !== 'production' || !isStrictProfile(profile)) return;
  throw new AstraError(
    'plugin.incompatible',
    `${pluginId} declares ${profile}, but its policy documents are not enforced yet. ` +
      'Do not run regulated plugins in production until the policy engine is implemented.',
  );
}
