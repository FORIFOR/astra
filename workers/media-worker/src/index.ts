/**
 * @astra/worker-media
 *
 * 会議の仕上げと、画像・動画の書き出しを拾う worker。正本 §26。
 * 時間のかかる仕事をここに閉じ込め、短い仕事の列を空けておく。
 */
import { TASK_QUEUES } from '@astra/service-task';

export const MEDIA_QUEUE = TASK_QUEUES.media;

export const MEDIA_TOOLS = [
  'meeting.seal',
  'meeting.transcribe',
  'meeting.reconcile',
  'meeting.summarize',
  'meeting.bundle',
] as const;
