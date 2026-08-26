/**
 * @astra/worker-domain
 *
 * plugin が持ち込んだ agent の仕事を拾う worker。正本 §26。
 *
 * **どの tool を拾うかは、起動時には決まらない。**
 * install された plugin が宣言したものが、そのまま対象になる。
 * ここで一覧を固定すると、install しても増えないことになる。
 */
import { TASK_QUEUES } from '@astra/service-task';

export const DOMAIN_QUEUE = TASK_QUEUES.domain;

/** plugin 由来の kind か。この worker が拾う範囲。 */
export function isDomainKind(kind: string): boolean {
  return kind.startsWith('plugin:');
}
