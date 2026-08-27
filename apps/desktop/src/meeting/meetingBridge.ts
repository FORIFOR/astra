/**
 * 会議の状態を window 間で渡す。
 *
 * 録音の正は main window の MeetingProvider。Dock は別 window なので、
 * 見せるための写し（snapshot）だけを event で受け取り、■ / ⏸ は命令として返す。
 * **Dock が録音そのものを持たない。**持つと、main を閉じたときに録音の行方が分からなくなる。
 */
import { isTauri } from '../host/tauri.js';

export interface MeetingSnapshotLine {
  readonly id: string;
  readonly speakerTag: number | null;
  readonly text: string;
  readonly interim: boolean;
}

export interface MeetingSnapshot {
  readonly phase: 'idle' | 'starting' | 'live' | 'finalizing';
  readonly state: 'recording' | 'paused' | 'degraded';
  readonly title: string;
  readonly elapsedMs: number;
  /** 直近の数行だけ。全文は main 側にある */
  readonly lines: readonly MeetingSnapshotLine[];
}

/** start は Dock のクイックメニューから。main が確認ダイアログを出す（いきなり録らない） */
export type MeetingCommand = 'start' | 'stop' | 'pause';

const SNAPSHOT_EVENT = 'astra://meeting';
const COMMAND_EVENT = 'astra://meeting-command';
/** Dock に流す行数。多いと下部の面が伸びすぎる */
export const SNAPSHOT_LINES = 6;

export async function publishMeeting(snapshot: MeetingSnapshot): Promise<void> {
  if (!isTauri()) return;
  try {
    const { emit } = await import('@tauri-apps/api/event');
    await emit(SNAPSHOT_EVENT, snapshot);
  } catch (error) {
    console.warn('could not publish the meeting state', error);
  }
}

export async function onMeeting(handler: (snapshot: MeetingSnapshot) => void): Promise<() => void> {
  if (!isTauri()) return () => undefined;
  try {
    const { listen } = await import('@tauri-apps/api/event');
    return await listen<MeetingSnapshot>(SNAPSHOT_EVENT, (event) => handler(event.payload));
  } catch (error) {
    console.warn('could not subscribe to the meeting state', error);
    return () => undefined;
  }
}

export async function sendMeetingCommand(command: MeetingCommand): Promise<void> {
  if (!isTauri()) return;
  try {
    const { emit } = await import('@tauri-apps/api/event');
    await emit(COMMAND_EVENT, { command });
  } catch (error) {
    console.warn('could not send the meeting command', error);
  }
}

export async function onMeetingCommand(
  handler: (command: MeetingCommand) => void,
): Promise<() => void> {
  if (!isTauri()) return () => undefined;
  try {
    const { listen } = await import('@tauri-apps/api/event');
    return await listen<{ command: MeetingCommand }>(COMMAND_EVENT, (event) =>
      handler(event.payload.command),
    );
  } catch (error) {
    console.warn('could not subscribe to meeting commands', error);
    return () => undefined;
  }
}

/** 00:00 / 1:02:03 の形。 */
export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = String(m).padStart(2, '0');
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}
