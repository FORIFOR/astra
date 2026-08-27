/** §14 の Risk を、利用者の言葉にする。tool 名も内部の enum も出さない。 */
import type { ActionRisk } from '@astra/contracts';

export const RISK_LABEL: Record<ActionRisk, string> = {
  READ: '参照',
  REVERSIBLE_WRITE: '下書き・変更（取り消せます）',
  EXTERNAL_COMMIT: '外部への送信',
  DESTRUCTIVE: '削除',
  REGULATED: '規制対象の記録',
  FINANCIAL: '金銭の処理',
};

/** §14.1「取り消し可否を表示」。承認前に、戻せるかどうかを言う。 */
export function reversibilityLabel(risk: ActionRisk): string {
  switch (risk) {
    case 'READ':
    case 'REVERSIBLE_WRITE':
      return '取り消せます';
    case 'DESTRUCTIVE':
      return '取り消せません（消えたものは戻りません）';
    default:
      return '取り消せません';
  }
}
