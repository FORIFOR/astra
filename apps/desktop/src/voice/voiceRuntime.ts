/**
 * Astra の headless voice runtime。
 *
 * Rust の実マイク／端末内 live STT、任意の Google Chirp 3 確定、
 * Local Agent Host の結果、Google TTS 再生を一つの状態列へ束ねる。
 * UI はこの状態と音量 getter だけを読み、通信実装を知らない。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AstraClient } from '@astra/api-client';
import type { VoiceSynthesisResponse } from '@astra/contracts';
import { isTauri, voice } from '../host/tauri.js';
import { startUxTimer } from '../ux/metrics.js';
import type { DockDictation } from '../dock/useDockMachine.js';
import { playVoiceAudio } from './audioPlayback.js';

export type VoiceMode =
  'idle' | 'connecting' | 'listening' | 'thinking' | 'speaking' | 'interrupted' | 'error';

export interface VoiceLevels {
  input: number;
  output: number;
}

/** 音量。React state にせず、Canvas が frame ごとに読む。 */
export function createLevelStore(): {
  set(level: VoiceLevels): void;
  input(): number;
  output(): number;
} {
  const current: VoiceLevels = { input: 0, output: 0 };
  return {
    set(level) {
      current.input = clamp(level.input);
      current.output = clamp(level.output);
    },
    input: () => current.input,
    output: () => current.output,
  };
}

function clamp(value: number): number {
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
}

export function foldTranscript(
  state: { committed: string; partial: string },
  event: { type: 'partial' | 'final'; text: string },
): { committed: string; partial: string } {
  if (event.type === 'final') {
    const text = event.text.trim();
    return {
      committed: text.length === 0 ? state.committed : joinText(state.committed, text),
      partial: '',
    };
  }
  return { ...state, partial: event.text };
}

function joinText(a: string, b: string): string {
  if (a.length === 0) return b;
  const needsSpace = /[A-Za-z0-9]$/.test(a) && /^[A-Za-z0-9]/.test(b);
  return needsSpace ? `${a} ${b}` : `${a}${b}`;
}

export function displayedText(state: { committed: string; partial: string }): string {
  return joinText(state.committed, state.partial);
}

/** Markdown の装飾を読み上げず、Google TTS の一要求上限内へ収める。 */
export function speechTextFor(markdown: string): string {
  const plain = markdown
    .replace(/```[\s\S]*?```/g, 'コードは結果に表示しています。')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^[-*+]\s+/gm, '')
    .replace(/[*_`>#]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (plain.length <= 4_800) return plain;
  return `${plain.slice(0, 4_760)}。続きは結果に表示しています。`;
}

export interface VoiceRuntime {
  readonly mode: VoiceMode;
  readonly transcript: string;
  readonly unavailable: string | null;
  readonly inputLevel: () => number;
  readonly outputLevel: () => number;
  readonly cloudCorrectionAllowed: boolean;
  setCloudCorrectionAllowed(allowed: boolean): void;
  readonly dictation: DockDictation | undefined;
  /** 次に送る入力が音声由来かを一度だけ取り出す。 */
  readonly consumeVoiceTurn: () => boolean;
  beginThinking(): void;
  speakResult(markdown: string): Promise<void>;
  interrupt(): void;
  settle(): void;
}

export function useVoiceRuntime(client: AstraClient | null = null): VoiceRuntime {
  const [mode, setMode] = useState<VoiceMode>('idle');
  const [unavailable, setUnavailable] = useState<string | null>(null);
  const [transcriptText, setTranscriptText] = useState('');
  const [cloudCorrectionAllowed, setCloudCorrectionAllowed] = useState(false);
  const levels = useMemo(createLevelStore, []);
  const transcript = useRef({ committed: '', partial: '' });
  const handlers = useRef<{ onPartial(text: string): void; onFinal(text: string): void } | null>(
    null,
  );
  const pendingVoiceTurn = useRef(false);
  const responseShouldSpeak = useRef(false);
  const turnGeneration = useRef(0);
  const playback = useRef<AbortController | null>(null);
  // §23: マイクが拾い始めるまで / 最初の文字が出るまで。start() で仕掛け、最初の event で止める
  const firstLevel = useRef<(() => void) | null>(null);
  const firstPartial = useRef<(() => void) | null>(null);
  const available = useMemo(isTauri, []);

  const transition = useCallback(
    (next: VoiceMode): void => {
      setMode(next);
      if (next === 'idle') levels.set({ input: 0, output: 0 });
      void voice.setMode(next);
    },
    [levels],
  );

  useEffect(() => {
    if (!available) return;
    let cancelled = false;
    const offs: (() => void)[] = [];
    const keep = (off: () => void): void => {
      if (cancelled) off();
      else offs.push(off);
    };
    void voice
      .onLevel((level) => {
        levels.set(level);
        if (level.input > 0 && firstLevel.current) {
          firstLevel.current();
          firstLevel.current = null;
        }
      })
      .then(keep);
    void voice
      .onTranscript((event) => {
        if (firstPartial.current) {
          firstPartial.current();
          firstPartial.current = null;
        }
        transcript.current = foldTranscript(transcript.current, event);
        const text = displayedText(transcript.current);
        setTranscriptText(text);
        if (event.type === 'final') handlers.current?.onFinal(text);
        else handlers.current?.onPartial(text);
      })
      .then(keep);
    void voice.onUnavailable((reason) => setUnavailable(reason)).then(keep);
    void voice.onMode((next) => setMode(next)).then(keep);
    return () => {
      cancelled = true;
      offs.forEach((off) => off());
    };
  }, [available, levels]);

  const stopPlayback = useCallback(() => {
    if (!playback.current) return false;
    playback.current.abort();
    playback.current = null;
    return true;
  }, []);

  const start = useCallback(
    async (nextHandlers: { onPartial(text: string): void; onFinal(text: string): void }) => {
      stopPlayback();
      turnGeneration.current += 1;
      pendingVoiceTurn.current = true;
      responseShouldSpeak.current = false;
      handlers.current = nextHandlers;
      transcript.current = { committed: '', partial: '' };
      setTranscriptText('');
      setUnavailable(null);
      transition('connecting');
      firstLevel.current = startUxTimer('mic_capture_start');
      firstPartial.current = startUxTimer('stt_first_partial');
      try {
        await voice.start();
        transition('listening');
      } catch (error) {
        transition('error');
        throw error instanceof Error ? error : new Error(String(error));
      }
    },
    [stopPlayback, transition],
  );

  const stop = useCallback(async () => {
    const captured = await voice.stop();
    levels.set({ input: 0, output: 0 });

    if (cloudCorrectionAllowed && client && captured && captured.audioBase64.length > 0) {
      transition('connecting');
      try {
        const corrected = await client.transcribeVoice({
          audio_base64: captured.audioBase64,
          sample_rate_hz: captured.sampleRateHz,
          language: 'ja-JP',
        });
        if (corrected.text.trim().length > 0) {
          transcript.current = { committed: corrected.text.trim(), partial: '' };
          setTranscriptText(corrected.text.trim());
          handlers.current?.onFinal(corrected.text.trim());
        }
      } catch (error) {
        setUnavailable(
          error instanceof Error
            ? `Google 音声認識で確定できませんでした（${error.message}）`
            : 'Google 音声認識で確定できませんでした。',
        );
      }
    }

    transition('idle');
    handlers.current = null;
  }, [client, cloudCorrectionAllowed, levels, transition]);

  const dictation = useMemo<DockDictation | undefined>(
    () => (available ? { start, stop } : undefined),
    [available, start, stop],
  );

  const consumeVoiceTurn = useCallback(() => {
    const fromVoice = pendingVoiceTurn.current;
    pendingVoiceTurn.current = false;

    // 新しい入力は、前の読み上げと遅れて返った TTS を必ず無効にする。
    turnGeneration.current += 1;
    stopPlayback();
    responseShouldSpeak.current = fromVoice;
    if (!fromVoice) transition('idle');
    return fromVoice;
  }, [stopPlayback, transition]);

  const beginThinking = useCallback(() => {
    if (pendingVoiceTurn.current) transition('thinking');
  }, [transition]);

  const speakResult = useCallback(
    async (markdown: string) => {
      if (!responseShouldSpeak.current) return;
      const generation = turnGeneration.current;
      const text = speechTextFor(markdown);
      if (!client || text.length === 0) {
        responseShouldSpeak.current = false;
        transition('idle');
        return;
      }

      let spoken: VoiceSynthesisResponse;
      try {
        transition('thinking');
        spoken = await client.synthesizeVoice({ text, language: 'ja-JP' });
      } catch (error) {
        setUnavailable(
          error instanceof Error
            ? `読み上げられませんでした（${error.message}）`
            : '読み上げられませんでした。',
        );
        transition('error');
        responseShouldSpeak.current = false;
        return;
      }

      // 音声合成中に次の入力が始まった場合、古い返答を再生しない。
      if (generation !== turnGeneration.current || !responseShouldSpeak.current) return;

      const controller = new AbortController();
      playback.current = controller;
      transition('speaking');
      try {
        await playVoiceAudio(
          spoken,
          (output) => {
            levels.set({ input: 0, output });
            void voice.setOutputLevel(output);
          },
          controller.signal,
        );
      } catch (error) {
        if (!(error instanceof DOMException && error.name === 'AbortError')) {
          setUnavailable(error instanceof Error ? error.message : String(error));
          transition('error');
        }
      } finally {
        if (generation === turnGeneration.current) {
          playback.current = null;
          responseShouldSpeak.current = false;
          transition('idle');
        }
      }
    },
    [client, levels, transition],
  );

  const interrupt = useCallback(() => {
    turnGeneration.current += 1;
    const interrupted = stopPlayback() || responseShouldSpeak.current;
    pendingVoiceTurn.current = false;
    responseShouldSpeak.current = false;
    if (interrupted) transition('interrupted');
  }, [stopPlayback, transition]);

  const settle = useCallback(() => {
    turnGeneration.current += 1;
    stopPlayback();
    pendingVoiceTurn.current = false;
    responseShouldSpeak.current = false;
    transition('idle');
  }, [stopPlayback, transition]);

  useEffect(() => () => playback.current?.abort(), []);

  return {
    mode,
    transcript: transcriptText,
    unavailable,
    inputLevel: levels.input,
    outputLevel: levels.output,
    cloudCorrectionAllowed,
    setCloudCorrectionAllowed,
    dictation,
    consumeVoiceTurn,
    beginThinking,
    speakResult,
    interrupt,
    settle,
  };
}
