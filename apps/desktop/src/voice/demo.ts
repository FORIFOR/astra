/**
 * 見た目の確認用。`#/dock?demo=listening` のように hash で姿を指定する。
 *
 * 開発ビルドでしか効かない。本番でマイク無しに「聞いています」の姿が出せてはいけない。
 * 音量は合成（正弦波）。Orb と波形が音量に反応することを、マイク無しで確かめるため。
 */
import type { InteractionState } from '@astra/ui-kit';
import type { VoiceMode } from './voiceRuntime.js';

export interface VoiceDemo {
  readonly mode: VoiceMode;
  readonly state: InteractionState;
  readonly levels: { input: () => number; output: () => number };
}

const STATE_FOR: Record<string, InteractionState> = {
  ready: 'READY',
  typing: 'TYPING',
  listening: 'LISTENING',
  thinking: 'UNDERSTANDING',
  speaking: 'READY',
  connecting: 'READY',
  error: 'READY',
};

const MODE_FOR: Record<string, VoiceMode> = {
  ready: 'idle',
  typing: 'idle',
  listening: 'listening',
  thinking: 'thinking',
  speaking: 'speaking',
  connecting: 'connecting',
  error: 'error',
};

/** 合成音量。0.15〜0.85 の間を 1.3 秒でうねる。 */
export function syntheticLevel(now: number = Date.now()): number {
  return 0.5 + 0.35 * Math.sin((now / 1300) * Math.PI * 2);
}

export function voiceDemoFrom(hash: string, dev: boolean): VoiceDemo | null {
  if (!dev) return null;
  const query = hash.split('?')[1];
  if (!query) return null;
  const which = new URLSearchParams(query).get('demo');
  if (!which || !(which in MODE_FOR)) return null;
  const mode = MODE_FOR[which]!;
  const live = mode === 'listening' || mode === 'speaking';
  return {
    mode,
    state: STATE_FOR[which]!,
    levels: {
      input: () => (mode === 'listening' ? syntheticLevel() : 0),
      output: () => (mode === 'speaking' ? syntheticLevel() : 0),
    },
    ...(live ? {} : {}),
  };
}
