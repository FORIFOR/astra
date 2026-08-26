/**
 * @astra/worker-document
 *
 * 文書の生成と変換を拾う worker。正本 §26。
 *
 * **まだ引き受ける tool が無い。**列だけ先に決めてあるのは、
 * 足すときに配備を変えなくて済むようにするため。
 * 空のまま worker を起動すると仕事が拾われないので、
 * 起動する側が `DOCUMENT_TOOLS` の空を見て判断する。
 */
import { TASK_QUEUES } from '@astra/service-task';

export const DOCUMENT_QUEUE = TASK_QUEUES.document;

export const DOCUMENT_TOOLS: readonly string[] = [];
