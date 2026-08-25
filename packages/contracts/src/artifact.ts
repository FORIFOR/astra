/**
 * Library の成果物。正本 §2.3、実装仕様 §3.5 / §8。
 */
import { z } from 'zod';
import { ArtifactId, MeetingId, TaskId, TenantId, UserId } from './ids.js';
import { Sha256Hex, Timestamp } from './primitives.js';

export const ArtifactType = z.enum([
  'REPORT',
  'DOCUMENT',
  'TRANSCRIPT',
  'MEETING_BUNDLE',
  'IMAGE',
  'VIDEO',
  'AUDIO',
  'CODE',
  'DATASET',
  'OTHER',
]);
export type ArtifactType = z.infer<typeof ArtifactType>;

/** 正本 §6.3 の data classification と同一集合。Context Capsule と共用する。 */
export const Sensitivity = z.enum(['PUBLIC', 'PRIVATE', 'CONFIDENTIAL', 'REGULATED']);
export type Sensitivity = z.infer<typeof Sensitivity>;

export const Artifact = z.object({
  id: ArtifactId,
  tenant_id: TenantId,
  owner_id: UserId,
  type: ArtifactType,
  title: z.string().max(500),
  mime_type: z.string().max(255),
  source_agent_id: z.string().nullable(),
  source_task_id: TaskId.nullable(),
  source_meeting_id: MeetingId.nullable(),
  parent_artifact_id: ArtifactId.nullable(),
  version: z.number().int().positive(),
  object_key: z.string(),
  size: z.number().int().nonnegative(),
  sha256: Sha256Hex,
  tags: z.array(z.string().max(64)).max(50).default([]),
  /** Phase 6 (World Model) まで常に空。列だけ先に用意する。 */
  entities: z.array(z.unknown()).default([]),
  lineage: z.array(z.unknown()).default([]),
  sensitivity: Sensitivity.default('PRIVATE'),
  searchable_text_ref: z.string().nullable(),
  created_at: Timestamp,
  updated_at: Timestamp,
});
export type Artifact = z.infer<typeof Artifact>;

export const ArtifactVersion = z.object({
  artifact_id: ArtifactId,
  version: z.number().int().positive(),
  object_key: z.string(),
  size: z.number().int().nonnegative(),
  sha256: Sha256Hex,
  created_by: UserId,
  created_at: Timestamp,
});
export type ArtifactVersion = z.infer<typeof ArtifactVersion>;

/** Phase 0 の直接アップロード上限（実装仕様 §8.3）。これを超えるものは Phase 2 の署名付き URL 経路。 */
export const MAX_DIRECT_UPLOAD_BYTES = 25 * 1024 * 1024;

export const CreateArtifactRequest = z.object({
  type: ArtifactType,
  title: z.string().min(1).max(500),
  mime_type: z.string().max(255),
  source_task_id: TaskId.optional(),
  parent_artifact_id: ArtifactId.optional(),
  tags: z.array(z.string().max(64)).max(50).default([]),
  sensitivity: Sensitivity.default('PRIVATE'),
});
export type CreateArtifactRequest = z.infer<typeof CreateArtifactRequest>;

/**
 * object key 規約（実装仕様 §8.2）。テナント ID を先頭に置き、
 * バケットレベルの誤設定でも越境しにくくする。
 */
export function objectKeyFor(
  tenantId: string,
  artifactId: string,
  version: number,
  fileName: string,
): string {
  return `t/${tenantId}/a/${artifactId}/v/${version}/${safeFileName(fileName)}`;
}

export function safeFileName(name: string): string {
  const dot = name.lastIndexOf('.');
  const hasExt = dot > 0 && dot < name.length - 1;
  const rawBase = hasExt ? name.slice(0, dot) : name;
  const rawExt = hasExt ? name.slice(dot + 1) : '';

  // 拡張子を先に切り出してから両方を個別に浄化する。まとめて処理すると
  // 非 ASCII の題名で拡張子まで落ちる（例: 「会議 議事録.md」）。
  const clean = (s: string): string =>
    s
      .normalize('NFKD')
      .replace(/[^\x20-\x7E]/g, '_')
      .replace(/[/\\?%*:|"<>.]/g, '_')
      .replace(/\s+/g, '_')
      .replace(/_{2,}/g, '_')
      .replace(/^_+|_+$/g, '');

  const base = clean(rawBase).slice(0, 100) || 'artifact';
  const ext = clean(rawExt).slice(0, 16);
  return ext ? `${base}.${ext}` : base;
}
