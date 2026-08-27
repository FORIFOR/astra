/**
 * 声の状態。UI/UX §4.1・§21・§23。
 *
 * Deepgram の headless runtime と同じ分け方:
 *   runtime（Rust の取り込み + 手元の認識） → 状態と event → UI
 *
 * ここは **UI が読む状態**だけを持つ。再描画を起こさない値
 * （音量）は getter で渡す — Orb は 60Hz で読むので、
 * 音量のたびに React を回すと画面が止まる。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { isTauri, voice } from '../host/tauri.js';
import type { DockDictation } from '../dock/useDockMachine.js';

export type VoiceMode =
  'idle' | 'connecting' | 'listening' | 'thinking' | 'speaking' | 'interrupted' | 'error';

export interface VoiceLevels {
  input: number;
  output: number;
}

/** 音量。**React の state にしない。**Orb が frame ごとに読む。 */
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

/**
 * 途中経過の畳み込み。
 *
 * partial は最新で置き換え、final は確定として積む。
 * **final のあとに古い partial が来ても、確定を崩さない。**
 */
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
  // 日本語は空白で繋がない。英字同士のときだけ空ける。
  const needsSpace = /[A-Za-z0-9]$/.test(a) && /^[A-Za-z0-9]/.test(b);
  return needsSpace ? `${a} ${b}` : `${a}${b}`;
}

/** UI が読む、いまの声の姿。 */
export function displayedText(state: { committed: string; partial: string }): string {
  return joinText(state.committed, state.partial);
}

export interface VoiceRuntime {
  readonly mode: VoiceMode;
  /** 手元の認識が使えないときの理由。使えるなら null。 */
  readonly unavailable: string | null;
  readonly inputLevel: () => number;
  readonly outputLevel: () => number;
  /** Dock の mic が使う口。ブラウザなど取り込めない環境では undefined。 */
  readonly dictation: DockDictation | undefined;
}

export function useVoiceRuntime(): VoiceRuntime {
  const [mode, setMode] = useState<VoiceMode>('idle');
  const [unavailable, setUnavailable] = useState<string | null>(null);
  const levels = useMemo(createLevelStore, []);
  const transcript = useRef({ committed: '', partial: '' });
  const handlers = useRef<{ onPartial(text: string): void; onFinal(text: string): void } | null>(
    null,
  );
  const available = useMemo(isTauri, []);

  useEffect(() => {
    if (!available) return;
    const offs: (() => void)[] = [];
    void voice.onLevel((level) => levels.set(level)).then((off) => offs.push(off));
    void voice
      .onTranscript((event) => {
        transcript.current = foldTranscript(transcript.current, event);
        const text = displayedText(transcript.current);
        if (event.type === 'final') handlers.current?.onFinal(text);
        else handlers.current?.onPartial(text);
      })
      .then((off) => offs.push(off));
    void voice.onUnavailable((reason) => setUnavailable(reason)).then((off) => offs.push(off));
    return () => offs.forEach((off) => off());
  }, [available, levels]);

  const start = useCallback(
    async (h: { onPartial(text: string): void; onFinal(text: string): void }) => {
      handlers.current = h;
      transcript.current = { committed: '', partial: '' };
      setMode('connecting');
      try {
        await voice.start();
        setMode('listening');
      } catch (error) {
        setMode('error');
        // 聞けなかったことを、黙って飲み込まない
        throw error instanceof Error ? error : new Error(String(error));
      }
    },
    [],
  );

  const stop = useCallback(async () => {
    await voice.stop();
    levels.set({ input: 0, output: 0 });
    setMode('idle');
    handlers.current = null;
  }, [levels]);

  const dictation = useMemo<DockDictation | undefined>(
    () => (available ? { start, stop } : undefined),
    [available, start, stop],
  );

  return {
    mode,
    unavailable,
    inputLevel: levels.input,
    outputLevel: levels.output,
    dictation,
  };
}
