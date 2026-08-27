/**
 * Dock の Orb が取る姿。Deepgram の floating-orb は
 * idle → connecting → listening → thinking → speaking と姿が変わり、Orb 自体が入口。
 *
 * 音声 runtime（マイク / 読み上げ）と Dock の対話状態を一つに畳む。
 * **読み上げ中は runtime が勝つ。** 話しているのに「考えています」の姿だと嘘になる。
 */
import type { InteractionState } from '@astra/ui-kit';
import type { VoiceMode } from '../voice/voiceRuntime.js';

export function dockVoiceMode(state: InteractionState, runtime: VoiceMode = 'idle'): VoiceMode {
  if (runtime === 'speaking' || runtime === 'connecting' || runtime === 'error') return runtime;
  switch (state) {
    case 'LISTENING':
      return 'listening';
    case 'UNDERSTANDING':
    case 'WORKING':
      return 'thinking';
    default:
      return runtime === 'listening' || runtime === 'thinking' ? 'idle' : runtime;
  }
}

/** Orb の横に添える一言。HUD と同じ語彙（VoiceHudApp）。 */
export function voiceModeLabel(mode: VoiceMode): string | null {
  switch (mode) {
    case 'connecting':
      return '音声を準備しています';
    case 'listening':
      return '聞いています';
    case 'thinking':
      return '考えています';
    case 'speaking':
      return 'Astra が話しています';
    case 'interrupted':
      return '割り込みました';
    case 'error':
      return '音声を続けられません';
    case 'idle':
      return null;
  }
}
