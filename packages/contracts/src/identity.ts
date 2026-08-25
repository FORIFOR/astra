/** テナント / ユーザー / デバイス / セッション。実装仕様 §4。 */
import { z } from 'zod';
import { DeviceId, SessionId, TenantId, UserId } from './ids.js';
import { Semver, Timestamp } from './primitives.js';
import { ComplianceProfile } from './plugin.js';

export const TenantKind = z.enum(['personal', 'organization']);
export type TenantKind = z.infer<typeof TenantKind>;

export const Tenant = z.object({
  id: TenantId,
  name: z.string().max(200),
  kind: TenantKind,
  compliance_profile: ComplianceProfile,
  created_at: Timestamp,
});
export type Tenant = z.infer<typeof Tenant>;

export const MembershipRole = z.enum(['owner', 'admin', 'member']);
export type MembershipRole = z.infer<typeof MembershipRole>;

export const User = z.object({
  id: UserId,
  email: z.email(),
  display_name: z.string().max(200),
  created_at: Timestamp,
});
export type User = z.infer<typeof User>;

export const Platform = z.enum(['macos', 'windows', 'linux', 'web']);
export type Platform = z.infer<typeof Platform>;

export const Device = z.object({
  id: DeviceId,
  tenant_id: TenantId,
  user_id: UserId,
  platform: Platform,
  name: z.string().max(200),
  app_version: Semver,
  last_seen_at: Timestamp.nullable(),
  created_at: Timestamp,
});
export type Device = z.infer<typeof Device>;

/** アクセストークンのクレーム。実装仕様 §4.2。 */
export const AccessTokenClaims = z.object({
  iss: z.string(),
  aud: z.string(),
  sub: UserId,
  tid: TenantId,
  did: DeviceId,
  scp: z.array(z.string()),
  jti: z.uuid(),
  iat: z.number().int(),
  exp: z.number().int(),
});
export type AccessTokenClaims = z.infer<typeof AccessTokenClaims>;

export const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;
export const REFRESH_TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60;
export const DEVICE_TOKEN_TTL_SECONDS = 24 * 60 * 60;

export const TokenResponse = z.object({
  access_token: z.string(),
  refresh_token: z.string(),
  /** host bridge 専用（aud: astra-host-bridge）。access token を bridge に使わせない。 */
  device_token: z.string(),
  expires_in: z.number().int().positive(),
  token_type: z.literal('Bearer'),
});
export type TokenResponse = z.infer<typeof TokenResponse>;

export const RefreshRequest = z.object({ refresh_token: z.string().min(1) });
export type RefreshRequest = z.infer<typeof RefreshRequest>;

/** 開発専用。ASTRA_ENV=development でのみルートを登録する（実装仕様 §4.3）。 */
export const DevTokenRequest = z.object({
  email: z.email(),
  display_name: z.string().max(200).default('Dev User'),
  device_name: z.string().max(200).default('dev-device'),
  platform: Platform.default('macos'),
  app_version: Semver.default('0.1.0'),
});
export type DevTokenRequest = z.infer<typeof DevTokenRequest>;

export const MeResponse = z.object({
  user: User,
  tenant: Tenant,
  device: Device,
  role: MembershipRole,
});
export type MeResponse = z.infer<typeof MeResponse>;

export const Session = z.object({
  id: SessionId,
  tenant_id: TenantId,
  user_id: UserId,
  device_id: DeviceId,
  expires_at: Timestamp,
  revoked_at: Timestamp.nullable(),
  created_at: Timestamp,
});
export type Session = z.infer<typeof Session>;
