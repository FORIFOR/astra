/**
 * 見た目の確認用。`#/dock?demo=listening` のように hash で姿を指定する。
 *
 * 開発ビルドでしか効かない。本番でマイク無しに「聞いています」の姿が出せてはいけない。
 * 音量は合成（正弦波）。Orb と波形が音量に反応することを、マイク無しで確かめるため。
 */
import type { DockSurface, InteractionState } from '@astra/ui-kit';
import type { VoiceMode } from './voiceRuntime.js';
import type { MeetingSnapshot } from '../meeting/meetingBridge.js';

export interface VoiceDemo {
  readonly mode: VoiceMode;
  readonly state: InteractionState;
  /** ピル（上部の細い入口）かカードか。 */
  readonly surface: DockSurface;
  readonly levels: { input: () => number; output: () => number };
  /** result: Dock の中で完結する短い答え（markdown）。 */
  readonly resultText: string | null;
  /** recording: 下部の Recording Dock に見せる写し。 */
  readonly meeting: MeetingSnapshot | null;
}

const MEETING_SAMPLE: MeetingSnapshot = {
  phase: 'live',
  state: 'recording',
  title: 'A社 商談',
  elapsedMs: 222_000,
  lines: [
    { id: 'l1', speakerTag: 1, text: '来月までに実装します', interim: false },
    { id: 'l2', speakerTag: 2, text: 'API 側はどうしますか？', interim: false },
    { id: 'l3', speakerTag: 1, text: '既存の口をそのまま', interim: true },
  ],
  link: 'online',
  pendingMs: 0,
};

const STATE_FOR: Record<string, InteractionState> = {
  idle: 'IDLE',
  'pill-listening': 'LISTENING',
  'pill-thinking': 'UNDERSTANDING',
  recording: 'RECORDING',
  processing: 'PROCESSING',
  ready: 'READY',
  typing: 'TYPING',
  listening: 'LISTENING',
  thinking: 'UNDERSTANDING',
  speaking: 'READY',
  connecting: 'READY',
  error: 'READY',
  result: 'RESULT',
};

const MODE_FOR: Record<string, VoiceMode> = {
  idle: 'idle',
  'pill-listening': 'listening',
  'pill-thinking': 'thinking',
  recording: 'idle',
  processing: 'idle',
  ready: 'idle',
  typing: 'idle',
  listening: 'listening',
  thinking: 'thinking',
  speaking: 'speaking',
  connecting: 'connecting',
  error: 'error',
  result: 'idle',
};

const RESULT_SAMPLE = [
  '**明日 10:00 の A社 商談**は会議室 B です。',
  '',
  '- 参加: 田中様、伊藤様、山田',
  '- 前回からの変更: 価格条件（`初期費用` の分割）',
  '',
  '1. 提案書 v5 を開く',
  '2. 競合比較レポートを添える',
].join('\n');

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
    surface: which === 'idle' || which.startsWith('pill-') ? 'pill' : 'card',
    levels: {
      input: () => (mode === 'listening' ? syntheticLevel() : 0),
      output: () => (mode === 'speaking' ? syntheticLevel() : 0),
    },
    resultText: which === 'result' ? RESULT_SAMPLE : null,
    meeting:
      which === 'recording'
        ? MEETING_SAMPLE
        : which === 'processing'
          ? { ...MEETING_SAMPLE, phase: 'finalizing' }
          : null,
  };
}
