/**
 * @astra/service-notification
 *
 * desktop push と proactive heartbeat。正本 §17。
 * **黙っている価値**を尊重するのが、この service の存在理由。
 */
export {
  Heartbeat,
  shouldNotify,
  type HeartbeatDeps,
  type HeartbeatOptions,
  type NotificationSink,
  type PendingNotification,
} from './heartbeat.js';
