/**
 * 規制区分の判定。正本 §22。
 *
 * かつてここには「規則が実行されていないので本番では拒む」ガードがあった。
 * **規則エンジンが入ったので、そのガードは消した**（OQ-25 は閉じた）。
 *
 * いま効いているもの:
 *   - compliance profile による判定（`@astra/policy` の `evaluate`）
 *   - profile ごとの組み込み規則（plugin が書き忘れても効く）
 *   - plugin が持ち込んだ規則（publish で語彙を検証済み）
 */
import { AstraError, type ComplianceProfile } from '@astra/contracts';

/** 個別 compliance gate を要する profile。正本 §22。 */
const STRICT_PROFILES: readonly ComplianceProfile[] = ['REGULATED_HEALTH', 'CARE', 'FINANCIAL'];

export function isStrictProfile(profile: ComplianceProfile): boolean {
  return STRICT_PROFILES.includes(profile);
}

/**
 * 規制区分の plugin が、規則を持たずに入ってこないか確かめる。
 *
 * manifest の不変条件は「規制 profile なら policies が要る」と言っているが、
 * **中身が空でも通ってしまう**ので、ここで実際の規則の有無を見る。
 * 規則の無い規制 plugin は、組み込み規則しか効かない状態になる。
 */
export function assertRegulatedPluginHasRules(
  profile: ComplianceProfile,
  ruleCount: number,
  pluginId: string,
): void {
  if (!isStrictProfile(profile)) return;
  if (ruleCount > 0) return;
  throw new AstraError(
    'plugin.manifest_invalid',
    `${pluginId} declares ${profile} but ships no enforceable rule. ` +
      'A regulated plugin must say what it will not do.',
  );
}
