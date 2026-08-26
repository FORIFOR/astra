/**
 * @astra/service-capabilities
 *
 * 起動時に「何が本物で、何が代役か」を答える。正本 §21・§25。
 *
 * **1 箇所で組む。**gateway と worker が別々に数えると、
 * 片方だけ新しい能力を見落とす（実際、gateway は言語モデルを見ていなかった）。
 */
export { capabilityReport } from './report.js';
