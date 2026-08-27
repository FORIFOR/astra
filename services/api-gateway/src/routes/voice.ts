/**
 * Astra Voice OS のクラウド音声境界。
 *
 * Deepgram へは送らない。明示的に許された確定用音声は Google Chirp 3、
 * 読み上げは Google TTS へ、既存 provider を通して送る。
 */
import {
  AstraError,
  VoiceSynthesisRequest,
  VoiceSynthesisResponse,
  VoiceTranscriptionRequest,
  VoiceTranscriptionResponse,
} from '@astra/contracts';
import type { BatchTranscriber } from '@astra/service-meeting';
import { SpeakError, type TtsProvider } from '@astra/tts';
import type { App } from '../fastify.js';
import { requirePrincipal } from '../auth/middleware.js';

export interface VoiceRouteDeps {
  /** 設定されていないときは undefined。無音の代役へは落とさない。 */
  readonly tts?: TtsProvider;
  /** Google Chirp 3 の実 provider だけを渡す。台本 provider は渡さない。 */
  readonly transcriber?: BatchTranscriber;
}

const VOICE_BODY_LIMIT = 4 * 1024 * 1024;

export function registerVoiceRoutes(app: App, deps: VoiceRouteDeps): void {
  app.post('/v1/voice/transcriptions', { bodyLimit: VOICE_BODY_LIMIT }, async (request) => {
    requirePrincipal();
    if (!deps.transcriber) {
      throw new AstraError('common.unavailable', 'Google speech recognition is not configured');
    }

    const body = VoiceTranscriptionRequest.parse(request.body ?? {});
    const audio = Buffer.from(body.audio_base64, 'base64');
    if (audio.byteLength === 0 || audio.byteLength % 2 !== 0) {
      throw new AstraError('common.validation_failed', 'audio must be non-empty PCM16');
    }

    try {
      const results = await deps.transcriber.transcribe(audio, {
        language: body.language,
        source: 'microphone',
        // Dock は一人の声。会議用の話者分離は求めない。
        minSpeakers: 1,
        maxSpeakers: 1,
      });
      return VoiceTranscriptionResponse.parse({
        text: results
          .filter((result) => result.isFinal)
          .map((result) => result.text)
          .join(''),
        provider: deps.transcriber.name,
        fallback_used: results.some((result) => result.fallbackUsed === true),
      });
    } catch {
      throw new AstraError('common.unavailable', 'speech recognition failed', {
        retryable: true,
      });
    }
  });

  app.post('/v1/voice/speech', async (request) => {
    requirePrincipal();
    if (!deps.tts) {
      throw new AstraError('common.unavailable', 'Google text to speech is not configured');
    }

    const body = VoiceSynthesisRequest.parse(request.body ?? {});
    try {
      const spoken = await deps.tts.speak({
        text: body.text,
        language: body.language,
        ...(body.voice === undefined ? {} : { voice: body.voice }),
        ...(body.speaking_rate === undefined ? {} : { speakingRate: body.speaking_rate }),
      });
      return VoiceSynthesisResponse.parse({
        audio_base64: Buffer.from(spoken.bytes).toString('base64'),
        mime_type: spoken.mimeType,
        voice: spoken.voice,
        sample_rate_hz: 16_000,
      });
    } catch (error) {
      if (!(error instanceof SpeakError)) throw error;
      throw speakErrorForApi(error);
    }
  });
}

function speakErrorForApi(error: SpeakError): AstraError {
  switch (error.reason) {
    case 'invalid_request':
    case 'unsupported_language':
      return new AstraError('common.validation_failed', error.message);
    case 'rate_limited':
      return new AstraError('common.rate_limited', error.message, { retryable: true });
    case 'permission_denied':
      return new AstraError('auth.forbidden', error.message);
    case 'not_configured':
    case 'timed_out':
    case 'cancelled':
    case 'provider_error':
      return new AstraError('common.unavailable', error.message, { retryable: true });
  }
  return new AstraError('common.unavailable', error.message, { retryable: true });
}
