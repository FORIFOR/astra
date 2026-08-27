/**
 * Voice OS の HTTP 境界。
 *
 * 音声の取り込みと live transcript は端末で行い、利用者が明示的に許した
 * ときだけ確定用の PCM を Google STT へ送る。返答の読み上げは Google TTS。
 * Deepgram は描画の正本であって、音声を送る先にはしない。
 */
import { z } from 'zod';

export const VOICE_SAMPLE_RATE_HZ = 16_000 as const;
export const VOICE_MAX_UTTERANCE_SECONDS = 60 as const;

/** 60 秒の mono PCM16 を base64 にしたときの上限に少し余裕を持たせる。 */
const MAX_PCM_BASE64_LENGTH = 2_700_000;

export const VoiceTranscriptionRequest = z.object({
  audio_base64: z.string().min(1).max(MAX_PCM_BASE64_LENGTH),
  sample_rate_hz: z.literal(VOICE_SAMPLE_RATE_HZ),
  language: z.string().min(2).max(35).default('ja-JP'),
});
export type VoiceTranscriptionRequest = z.infer<typeof VoiceTranscriptionRequest>;

export const VoiceTranscriptionResponse = z.object({
  text: z.string(),
  provider: z.string().min(1),
  fallback_used: z.boolean(),
});
export type VoiceTranscriptionResponse = z.infer<typeof VoiceTranscriptionResponse>;

export const VoiceSynthesisRequest = z.object({
  text: z.string().trim().min(1).max(5_000),
  language: z.string().min(2).max(35).default('ja-JP'),
  voice: z.string().min(1).max(120).optional(),
  speaking_rate: z.number().positive().max(4).optional(),
});
export type VoiceSynthesisRequest = z.infer<typeof VoiceSynthesisRequest>;

export const VoiceSynthesisResponse = z.object({
  audio_base64: z.string().min(1),
  mime_type: z.string().min(1),
  voice: z.string().min(1),
  sample_rate_hz: z.literal(VOICE_SAMPLE_RATE_HZ),
});
export type VoiceSynthesisResponse = z.infer<typeof VoiceSynthesisResponse>;
