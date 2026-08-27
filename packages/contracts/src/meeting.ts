/**
 * 会議。正本 §11・§12・§13、Phase 3 実装仕様 §2。
 *
 * 設計の要は 2 つ:
 *
 *   1. **live と final を競合させない。**streaming は速さ、batch は精度。
 *      final は live を書き換えず、別の `pass` として積む（D-25）。
 *      その場に見えていたものが後から消えるのが、この機能で一番まずい壊れ方。
 *
 *   2. **interim は保存しない。**1 秒に何度も差し替わるものを残しても
 *      後から価値が無く、append-only を成立させられない（D-24）。
 */
import { z } from 'zod';
import { ArtifactId, MeetingId, TaskId, TenantId, UserId } from './ids.js';
import { Timestamp } from './primitives.js';

export const MeetingSegmentId = z.uuid().brand<'MeetingSegmentId'>();
export type MeetingSegmentId = z.infer<typeof MeetingSegmentId>;

export const MeetingStatus = z.enum(['RECORDING', 'PAUSED', 'FINALIZING', 'COMPLETE', 'FAILED']);
export type MeetingStatus = z.infer<typeof MeetingStatus>;

/** live = streaming で確定したもの、final = 会議後の高精度パス。 */
export const TranscriptPass = z.enum(['live', 'final']);
export type TranscriptPass = z.infer<typeof TranscriptPass>;

/** 何を録っているか。UI/UX §12.1 は個別に状態表示することを求める。 */
export const AudioSource = z.enum(['microphone', 'system']);
export type AudioSource = z.infer<typeof AudioSource>;

// ------------------------------------------------------------------ meeting

export const Meeting = z.object({
  id: MeetingId,
  tenant_id: TenantId,
  title: z.string().min(1).max(200),
  status: MeetingStatus,
  /** 会議で話される言語。auto detect でも開始時の想定は残す（UI/UX §12.1）。 */
  language: z.string().min(2).max(16),
  /** 翻訳先。null なら翻訳しない。 */
  target_language: z.string().min(2).max(16).nullable(),
  audio_sources: z.array(AudioSource).min(1),
  /** 参加者への同意確認を UI が済ませた時刻。空では始めさせない。 */
  consent_at: Timestamp,
  started_at: Timestamp,
  ended_at: Timestamp.nullable(),
  /** STT が落ちた時刻。**録音は続く**（AC3-11）。 */
  degraded_at: Timestamp.nullable(),
  /** 録音そのもの。 */
  recording_artifact_id: ArtifactId.nullable(),
  /** summary / decisions / action items をまとめたもの。 */
  bundle_artifact_id: ArtifactId.nullable(),
  /** finalize を回している durable task。 */
  finalize_task_id: TaskId.nullable(),
  created_by: UserId,
  created_at: Timestamp,
  updated_at: Timestamp,
});
export type Meeting = z.infer<typeof Meeting>;

export const CreateMeetingRequest = z.object({
  title: z.string().min(1).max(200),
  language: z.string().min(2).max(16).default('ja-JP'),
  target_language: z.string().min(2).max(16).nullable().default(null),
  audio_sources: z.array(AudioSource).min(1).default(['microphone']),
  /** UI が同意確認を出したことの表明。false では始めない。 */
  consent_confirmed: z.literal(true),
});
export type CreateMeetingRequest = z.infer<typeof CreateMeetingRequest>;

// ------------------------------------------------------------------ segment

/** 音の出所。正本 §11.3。 */
export const AUDIO_PROVENANCE = ['microphone', 'system', 'mixed'] as const;
export const AudioProvenance = z.enum(AUDIO_PROVENANCE);
export type AudioProvenance = z.infer<typeof AudioProvenance>;

export const MeetingSegment = z.object({
  id: MeetingSegmentId,
  meeting_id: MeetingId,
  pass: TranscriptPass,
  /**
   * どの音源から来たか。**一次情報**（正本 §11.3・§12.2）。
   *
   * `microphone` = 自分 / `system` = 相手。
   * **話者分離より先に、これを見る。**分離が落ちても、
   * どちらの音から来たかは録音そのものの事実なので変わらない。
   * 分けられないときは `mixed`、分からないときは null（推測で埋めない）。
   */
  source: AudioProvenance.nullable().default(null),
  /** provider が付けた話者番号。**二次情報。**名前は meeting_speakers 側。 */
  speaker_tag: z.number().int().positive().nullable(),
  text: z.string(),
  start_ms: z.number().int().nonnegative(),
  end_ms: z.number().int().nonnegative(),
  language: z.string().min(2).max(16).nullable(),
  /** provider の自信。overlap や不確実な箇所を UI が淡く出すのに使う。 */
  confidence: z.number().min(0).max(1).nullable(),
  /** final パスが、どの live segment を置き換えたか。live 側は触らない（D-25）。 */
  supersedes: z.array(MeetingSegmentId).default([]),
  created_at: Timestamp,
});
export type MeetingSegment = z.infer<typeof MeetingSegment>;

// ------------------------------------------------------------------ speaker

/**
 * speaker_tag → 表示名。**この会議の中だけ**の対応。
 * 声による人物特定はしない（biometric 扱いになり得る。正本 §11.3、D-27）。
 */
export const MeetingSpeaker = z.object({
  meeting_id: MeetingId,
  speaker_tag: z.number().int().positive(),
  display_name: z.string().min(1).max(100),
  named_by: UserId,
  created_at: Timestamp,
});
export type MeetingSpeaker = z.infer<typeof MeetingSpeaker>;

export const NameSpeakerRequest = z.object({
  speaker_tag: z.number().int().positive(),
  display_name: z.string().min(1).max(100),
});
export type NameSpeakerRequest = z.infer<typeof NameSpeakerRequest>;

// -------------------------------------------------------------- translation

export const MeetingTranslation = z.object({
  segment_id: MeetingSegmentId,
  meeting_id: MeetingId,
  target_language: z.string().min(2).max(16),
  text: z.string(),
  created_at: Timestamp,
});
export type MeetingTranslation = z.infer<typeof MeetingTranslation>;

// ------------------------------------------------------------------- bundle

/**
 * summary の 1 項目。**根拠なしの断定を作らない。**
 * UI/UX §12.6 の「引用番号を押すと transcript へ jump」はこれが担保する。
 */
export const MeetingClaim = z.object({
  text: z.string().min(1),
  citations: z
    .array(z.object({ segment_id: MeetingSegmentId, start_ms: z.number().int().nonnegative() }))
    .min(1),
});
export type MeetingClaim = z.infer<typeof MeetingClaim>;

export const MeetingActionItem = MeetingClaim.extend({
  /** 誰がやるか。分からなければ null。埋めない。 */
  assignee: z.string().max(100).nullable().default(null),
  due: z.string().max(100).nullable().default(null),
});
export type MeetingActionItem = z.infer<typeof MeetingActionItem>;

export const MeetingBundle = z.object({
  meeting_id: MeetingId,
  title: z.string(),
  duration_ms: z.number().int().nonnegative(),
  speaker_count: z.number().int().nonnegative(),
  summary: z.array(MeetingClaim),
  decisions: z.array(MeetingClaim),
  action_items: z.array(MeetingActionItem),
  /** answered されなかった問い。埋めずに残すほうが役に立つ。 */
  open_questions: z.array(MeetingClaim),
});
export type MeetingBundle = z.infer<typeof MeetingBundle>;

// ------------------------------------------------------------- ws control

/** 音声 WS の制御メッセージ。binary は音声、text(JSON) はこれ（実装仕様 §3）。 */
export const MeetingControlMessage = z.discriminatedUnion('type', [
  z.object({ type: z.literal('pause') }),
  z.object({ type: z.literal('resume') }),
  z.object({
    type: z.literal('marker'),
    kind: z.enum(['important', 'decision', 'todo']),
    at_ms: z.number().int().nonnegative(),
  }),
]);
export type MeetingControlMessage = z.infer<typeof MeetingControlMessage>;

/** 会議の経過時刻をフレーム数から出す。取りこぼしても時刻がずれない。 */
export const AUDIO_SAMPLE_RATE_HZ = 16_000;
export const AUDIO_FRAME_MS = 100;

/** 一つの segment をここまでで打ち切る。長すぎる塊は引用に使えない。 */
export const MAX_SEGMENT_MS = 20_000;
