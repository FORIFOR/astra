/**
 * 読み上げ。正本 §27（DeepNote から引き継ぐ TTS）、§23。
 *
 * **差し替え口を先に置く。**提供者が変わっても、呼ぶ側を書き直さない。
 *
 * 計測は「最初の音が出るまで」が要。全部届いてから鳴らすと、
 * 短い返事でも待たされる（§23 の考え方をそのまま音へ持ち込む）。
 */

export interface SpeakRequest {
  readonly text: string;
  /** `ja-JP` のような地域付き。 */
  readonly language: string;
  /** 提供者ごとの声の名前。無ければ既定。 */
  readonly voice?: string | undefined;
  /** 1.0 が等速。0 や負を受け取らない。 */
  readonly speakingRate?: number | undefined;
}

export interface SpokenAudio {
  readonly bytes: Uint8Array;
  readonly mimeType: string;
  /** 何で読んだか。版を比べるときに要る。 */
  readonly voice: string;
}

/** 読み上げられない理由。**「失敗しました」で済ませない。** */
export const SPEAK_FAILURES = [
  'not_configured',
  'permission_denied',
  'rate_limited',
  'timed_out',
  'cancelled',
  'unsupported_language',
  'invalid_request',
  'provider_error',
] as const;
export type SpeakFailure = (typeof SPEAK_FAILURES)[number];

export class SpeakError extends Error {
  readonly reason: SpeakFailure;
  constructor(reason: SpeakFailure, message: string) {
    super(message);
    this.name = 'SpeakError';
    this.reason = reason;
  }
}

/** 何をすれば直るか。§21「影響と次の選択肢を書く」。 */
export const SPEAK_RECOVERY: Readonly<Record<SpeakFailure, string>> = {
  not_configured: '読み上げの接続が設定されていません。',
  permission_denied: '読み上げを使う権限がありません。',
  rate_limited: '読み上げの利用が混み合っています。少し待って試してください。',
  timed_out: '読み上げが時間内に返りませんでした。',
  cancelled: '読み上げを止めました。',
  unsupported_language: 'この言語の声がありません。',
  invalid_request: '読み上げる内容を確認してください。',
  provider_error: '読み上げに失敗しました。',
};

export interface TtsProvider {
  readonly name: string;
  readonly isStandIn: boolean;
  speak(request: SpeakRequest, signal?: AbortSignal): Promise<SpokenAudio>;
}

/** 読み上げる前に断れるもの。**投げる前に見る。** */
export function speakProblems(request: SpeakRequest): string[] {
  const problems: string[] = [];
  if (request.text.trim().length === 0) problems.push('読み上げる文がありません');
  if (request.text.length > 5_000) problems.push('一度に読み上げるには長すぎます');
  if (request.language.trim().length === 0) problems.push('言語が指定されていません');
  if (request.speakingRate !== undefined && request.speakingRate <= 0) {
    // 0 や負だと、鳴らないか壊れる
    problems.push('読み上げの速さが 0 以下です');
  }
  return problems;
}

/**
 * 無音を返す代役。**音は作れないので作ったふりをしない。**
 *
 * 経路（要求 → 音 → 再生）を試すのに要るのはここまで。
 */
export class SilentTtsProvider implements TtsProvider {
  readonly name = 'silent';
  readonly isStandIn = true;

  async speak(request: SpeakRequest): Promise<SpokenAudio> {
    const problems = speakProblems(request);
    if (problems.length > 0) throw new SpeakError('invalid_request', problems.join(' / '));
    // 長さだけ本物らしくする（再生側の扱いを試せるように）
    const samples = Math.min(16_000 * 10, request.text.length * 800);
    return {
      bytes: new Uint8Array(samples * 2),
      mimeType: 'audio/l16; rate=16000',
      voice: 'silent',
    };
  }
}
