/**
 * 識別子。実装仕様 §1.2。
 *
 * すべて UUIDv7。branded type にして取り違えを型で防ぐ。
 * 文字列から作るときは必ず `XxxId.parse()` を通す（生キャストを書かない）。
 */
import { z } from 'zod';

const id = <B extends string>(brand: B) => z.uuid().brand<B>();

export const TenantId = id('TenantId');
export const UserId = id('UserId');
export const DeviceId = id('DeviceId');
export const SessionId = id('SessionId');
export const ConversationId = id('ConversationId');
export const TurnId = id('TurnId');
export const TaskId = id('TaskId');
export const ApprovalId = id('ApprovalId');
export const ReceiptId = id('ReceiptId');
export const ArtifactId = id('ArtifactId');
export const MeetingId = id('MeetingId');
export const EventId = id('EventId');
export const InstallId = id('InstallId');

export type TenantId = z.infer<typeof TenantId>;
export type UserId = z.infer<typeof UserId>;
export type DeviceId = z.infer<typeof DeviceId>;
export type SessionId = z.infer<typeof SessionId>;
export type ConversationId = z.infer<typeof ConversationId>;
export type TurnId = z.infer<typeof TurnId>;
export type TaskId = z.infer<typeof TaskId>;
export type ApprovalId = z.infer<typeof ApprovalId>;
export type ReceiptId = z.infer<typeof ReceiptId>;
export type ArtifactId = z.infer<typeof ArtifactId>;
export type MeetingId = z.infer<typeof MeetingId>;
export type EventId = z.infer<typeof EventId>;
export type InstallId = z.infer<typeof InstallId>;

/** plugin id は逆ドメイン。UUID ではない（実装仕様 §1.1）。 */
export const PluginId = z
  .string()
  .regex(/^[a-z0-9]+(\.[a-z0-9-]+)+$/, 'plugin id must be reverse-domain, lowercase')
  .brand<'PluginId'>();
export type PluginId = z.infer<typeof PluginId>;

export const PublisherId = z
  .string()
  .regex(/^[a-z0-9][a-z0-9-]{0,63}$/)
  .brand<'PublisherId'>();
export type PublisherId = z.infer<typeof PublisherId>;
