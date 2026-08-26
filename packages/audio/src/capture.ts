/**
 * 取り込みの口。正本 §11・§12。
 *
 * 実装は端末側（Tauri / Rust）にある。ここが持つのは**契約**だけ。
 * 将来 cpal 以外に差し替えても、上の層を書き直さずに済むようにする。
 */
import type { AudioSourceKind, PcmFrame } from './frame.js';

export interface AudioCaptureConfig {
  /** 取りたい入力。**空にできない**（何も録らない録音を始めない）。 */
  readonly sources: readonly AudioSourceKind[];
  /** 入力装置。省略で既定。 */
  readonly deviceId?: string | undefined;
  /** マイクとシステム音声を混ぜた frame も出すか。 */
  readonly mix?: boolean;
}

/**
 * 取り込めない理由。**panic でも文字列でもなく、種別で扱う。**
 *
 * 「権限が無い」と「装置が無い」と「対応していない形式」は、
 * 利用者にとって別の話で、次にすることも違う。
 */
export const CAPTURE_FAILURES = [
  'microphone_permission_denied',
  'system_audio_permission_denied',
  'no_input_device',
  'device_removed',
  'unsupported_sample_format',
  'already_capturing',
  'not_capturing',
  'stream_ended',
] as const;
export type CaptureFailure = (typeof CAPTURE_FAILURES)[number];

export class AudioCaptureError extends Error {
  readonly reason: CaptureFailure;
  constructor(reason: CaptureFailure, message: string) {
    super(message);
    this.name = 'AudioCaptureError';
    this.reason = reason;
  }
}

/** 何をすれば直るか。§21「影響と次の選択肢を書く」。 */
export const CAPTURE_RECOVERY: Readonly<Record<CaptureFailure, string>> = {
  microphone_permission_denied: 'マイクの使用を許可してください。',
  system_audio_permission_denied: '画面収録の許可が要ります（システム音声の取り込みに使います）。',
  no_input_device: 'マイクが見つかりません。接続を確認してください。',
  device_removed: '入力装置が外れました。つなぎ直してください。',
  unsupported_sample_format: 'この装置の音声形式には対応していません。別の装置をお試しください。',
  already_capturing: 'すでに録音しています。',
  not_capturing: '録音していません。',
  stream_ended: '音声が途切れました。もう一度お試しください。',
};

export interface AudioStream {
  /** 届いた順に流れる。**欠番が出たら落ちている。** */
  frames(): AsyncIterable<PcmFrame>;
  stop(): Promise<void>;
}

export interface AudioCaptureProvider {
  readonly name: string;
  /** 取り込める入力。**取れないものを取れると言わない。** */
  available(): Promise<readonly AudioSourceKind[]>;
  start(config: AudioCaptureConfig): Promise<AudioStream>;
}

/** 設定として成立しているか。**何も録らない録音を始めない。** */
export function captureProblems(config: AudioCaptureConfig): string[] {
  const problems: string[] = [];
  if (config.sources.length === 0) problems.push('録音する音声が選ばれていません');
  if (config.mix === true && !config.sources.includes('microphone')) {
    problems.push('混合するにはマイクが要ります');
  }
  if (config.mix === true && !config.sources.includes('system')) {
    problems.push('混合するにはシステム音声が要ります');
  }
  return problems;
}
