/**
 * 手元の実行基盤。正本 §4.4・§16.1、UI/UX §22。
 *
 * **Dock は UI、Local Agent Host は実行基盤。**分けてある理由:
 *
 *   - Dock を閉じても仕事は続く（§4.4）。閉じたのは窓であって、仕事ではない
 *   - 言語モデルは利用者の持ち込み（Claude Code / 自分の API キー）なので、
 *     **端末が実行の場所**になる。サーバは調整役
 *
 * 端末が落ちたときに、**運営側のモデルへ黙って乗り換えない。**
 * 乗り換えると、利用者が選んだ経路と料金の外で処理が走る。
 * 代わりに仕事を止めて待ち、戻ったら続きから動かす。
 */
import { z } from 'zod';

/** Host の状態。**「動いている」と「繋がっている」を分ける。** */
export const HOST_STATES = ['online', 'offline', 'unknown'] as const;
export const HostState = z.enum(HOST_STATES);
export type HostState = z.infer<typeof HostState>;

/**
 * 仕事が止まっている理由。
 *
 * `host_offline` は**失敗ではない。**待てば戻る。
 * 失敗として扱うと、利用者は最初からやり直すことになる。
 */
export const PAUSE_REASONS = ['host_offline', 'provider_unavailable'] as const;
export const PauseReason = z.enum(PAUSE_REASONS);
export type PauseReason = z.infer<typeof PauseReason>;

export const PAUSE_MESSAGE: Readonly<Record<PauseReason, string>> = {
  host_offline: 'この仕事はお使いの端末で動いています。端末が戻ると、続きから再開します。',
  provider_unavailable: '選んでいるモデルにいま繋がりません。繋がり次第、続きから再開します。',
};

export const HostStatus = z.object({
  state: HostState,
  /** 最後に応答があった時刻。**分からないなら null**（今と言わない）。 */
  lastSeenAt: z.string().nullable().default(null),
  /** この端末で使えるモデル。空なら仕事を渡せない。 */
  models: z.array(z.string()).default([]),
});
export type HostStatus = z.infer<typeof HostStatus>;

/** 応答が無くなってから offline とみなすまで。短すぎると瞬断で止まる。 */
export const HOST_OFFLINE_AFTER_MS = 90_000;

/**
 * いま仕事を渡してよいか。
 *
 * **「分からない」を online として扱わない。**渡してから消えると、
 * 仕事は宙に浮く。
 */
export function canDispatch(status: HostStatus, now: number = Date.now()): boolean {
  if (status.state !== 'online') return false;
  if (status.models.length === 0) return false;
  if (status.lastSeenAt === null) return false;
  const seen = Date.parse(status.lastSeenAt);
  return Number.isFinite(seen) && now - seen < HOST_OFFLINE_AFTER_MS;
}

/** 応答の途絶から状態を導く。 */
export function stateFromHeartbeat(lastSeenAt: string | null, now: number = Date.now()): HostState {
  if (lastSeenAt === null) return 'unknown';
  const seen = Date.parse(lastSeenAt);
  if (!Number.isFinite(seen)) return 'unknown';
  return now - seen < HOST_OFFLINE_AFTER_MS ? 'online' : 'offline';
}

/**
 * 端末が落ちたときにどうするか。
 *
 * **運営側のモデルへ乗り換えない。**
 * 乗り換えると、利用者が選んだ経路と料金の外で処理が走る。
 * これは「気を利かせた」ではなく、約束を破ったことになる。
 */
export function shouldPauseInsteadOfFallback(runsOnHost: boolean, hostState: HostState): boolean {
  return runsOnHost && hostState !== 'online';
}

/**
 * 自動で再開してよいか。
 *
 * **承認待ちだったものは、戻っても勝手に進めない。**
 * 止まっている間に前提が変わっていることがある（§22 の stale approval と同じ理屈）。
 */
export function canAutoResume(_pausedFor: PauseReason, wasWaitingApproval: boolean): boolean {
  return !wasWaitingApproval;
}

/**
 * 端末が居ない / 返さない。**失敗ではない。**
 *
 * 契約側に置いてあるのは、cloud の worker がこれを
 * 「待てば進むもの」として見分けられるようにするため。
 * 名前の一致で見分けると、片方を改名した瞬間に静かに壊れ、
 * **端末が落ちただけの仕事が FAILED になる。**
 */
export class HostOfflineError extends Error {
  /** Temporal の失敗種別に使う名前。workflow 側と 1 箇所で合わせる。 */
  static readonly TYPE = 'HostOffline';

  constructor(message: string) {
    super(message);
    this.name = HostOfflineError.TYPE;
  }
}

/**
 * これは「待てば進む」か。
 *
 * **代替手段へ落とす前に見る。**端末が落ちているだけのときに
 * §24 の梯子を降りると、利用者が選んでいない経路で外部操作が起きる。
 */
export function isHostOfflineError(error: unknown): boolean {
  return error instanceof HostOfflineError;
}
