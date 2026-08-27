/**
 * 会議の進行を持つ。UI/UX §12。
 *
 * **5 つ目のタブにはしない**（正本 §2「4 タブ固定」）。会議は画面ではなく
 * 状態なので、shell の上に重ねる 1 本の surface として持つ:
 *
 *   開始確認 → 最小の indicator → Notes 中心の surface → finalize
 *
 * 進行中の会議はタブを跨いで見えていなければならない。Home を見ている間に
 * 録音が止まっていた、が起きないようにする。
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react';
import type { AstraClient } from '@astra/api-client';
import type { AudioSource, Meeting } from '@astra/contracts';
import { applyMeetingEvent, emptyMeetingView, type MeetingView } from './meetingView.js';
import type { RecordingState } from './RecordingIndicator.js';
import type { MeetingStartValues } from './StartConfirmation.js';
import { SNAPSHOT_LINES, onMeetingCommand, publishMeeting } from './meetingBridge.js';
import { meetingCapture, type MeetingLinkState, type RecoverableMeeting } from '../host/tauri.js';

export type MeetingPhase = 'idle' | 'starting' | 'live' | 'finalizing';

interface MeetingContextValue {
  readonly phase: MeetingPhase;
  readonly meeting: Meeting | null;
  readonly view: MeetingView;
  readonly state: RecordingState;
  readonly elapsedMs: number;
  readonly notes: string;
  readonly speakerNames: ReadonlyMap<number, string>;
  readonly finalizeTaskId: string | null;
  readonly error: string | null;
  /** 端末 → gateway の音声の接続。offline でも手元の断片には残っている。 */
  readonly link: MeetingLinkState | null;
  readonly pendingMs: number;
  /** 端末で音を取り込めない理由（ブラウザ、マイク無し等）。録音は成り立たない。 */
  readonly captureError: string | null;
  /** 前回落ちたまま残っている録音。送り直すか捨てるかを聞く。 */
  readonly recoverable: readonly RecoverableMeeting[];
  reupload(meetingId: string): Promise<void>;
  discardRecovery(meetingId: string): Promise<void>;
  /** 「会議を記録」から呼ぶ。まず確認を出す。いきなり録り始めない。 */
  requestStart(): void;
  cancelStart(): void;
  start(values: MeetingStartValues): Promise<void>;
  setNotes(value: string): void;
  togglePause(): void;
  nameSpeaker(speakerTag: number, displayName: string): Promise<void>;
  stop(): Promise<void>;
  dismiss(): void;
}

const MeetingContext = createContext<MeetingContextValue | null>(null);

export function MeetingProvider({
  client,
  children,
}: {
  client: AstraClient | null;
  children: ReactNode;
}): ReactElement {
  const [phase, setPhase] = useState<MeetingPhase>('idle');
  const [meeting, setMeeting] = useState<Meeting | null>(null);
  const [view, setView] = useState<MeetingView>(emptyMeetingView);
  const [notes, setNotes] = useState('');
  const [paused, setPaused] = useState(false);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [speakerNames, setSpeakerNames] = useState<ReadonlyMap<number, string>>(new Map());
  const [finalizeTaskId, setFinalizeTaskId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [link, setLink] = useState<MeetingLinkState | null>(null);
  const [pendingMs, setPendingMs] = useState(0);
  const [captureError, setCaptureError] = useState<string | null>(null);
  const [recoverable, setRecoverable] = useState<readonly RecoverableMeeting[]>([]);
  const abort = useRef<AbortController | null>(null);

  // 端末側の接続状態（Rust の uploader から）
  useEffect(() => {
    let off: (() => void) | null = null;
    let cancelled = false;
    void meetingCapture
      .onLink((event) => {
        setLink(event.state);
        setPendingMs(event.pendingMs);
      })
      .then((unlisten) => {
        if (cancelled) unlisten();
        else off = unlisten;
      });
    return () => {
      cancelled = true;
      off?.();
    };
  }, []);

  // 起動時: 落ちたまま残っている録音があるか
  const refreshRecoverable = useCallback(async () => {
    setRecoverable(await meetingCapture.recoverable());
  }, []);
  useEffect(() => {
    void refreshRecoverable();
  }, [refreshRecoverable]);

  // access token は 15 分で切れる。長い会議のために 5 分ごとに渡し直す
  useEffect(() => {
    if (phase !== 'live' || !client) return;
    const timer = setInterval(() => {
      void client.currentAccessToken().then((token) => {
        if (token) void meetingCapture.updateToken(token);
      });
    }, 5 * 60_000);
    return () => clearInterval(timer);
  }, [phase, client]);

  // 経過時間は開始時刻から数える。tick を数えると、
  // タブが背面に回った間にずれる。
  const startedAt = useRef<number | null>(null);
  useEffect(() => {
    if (phase !== 'live' || startedAt.current === null) return;
    const timer = setInterval(() => {
      setElapsedMs(Date.now() - startedAt.current!);
    }, 1_000);
    return () => clearInterval(timer);
  }, [phase]);

  const requestStart = useCallback(() => {
    setError(null);
    setPhase('starting');
  }, []);

  const cancelStart = useCallback(() => setPhase('idle'), []);

  const start = useCallback(
    async (values: MeetingStartValues): Promise<void> => {
      if (!client) return;
      try {
        const created = await client.startMeeting({
          title: values.title,
          language: values.language,
          target_language: values.targetLanguage,
          audio_sources: values.audioSources as AudioSource[],
          consent_confirmed: true,
        });
        setMeeting(created);
        setView(emptyMeetingView);
        setNotes('');
        setPaused(false);
        setSpeakerNames(new Map());
        startedAt.current = Date.now();
        setElapsedMs(0);
        setPhase('live');

        // 端末で音を取り込み、手元に残しながら送る。取り込めない環境ではそう言う。
        // **ここで失敗しても会議は成り立たせる**（理由は画面に出す）
        setCaptureError(null);
        try {
          const token = await client.currentAccessToken();
          if (!token) {
            setCaptureError('サインインの状態が確認できず、音声を取り込めません。');
          } else {
            await meetingCapture.start(created.id, client.baseUrl, token);
          }
        } catch (cause) {
          setCaptureError(
            `この環境では音声を取り込めません（${cause instanceof Error ? cause.message : String(cause)}）。`,
          );
        }
      } catch (cause) {
        // 何が起きたかを黙って飲み込まない
        setError(cause instanceof Error ? cause.message : String(cause));
        setPhase('idle');
      }
    },
    [client],
  );

  const nameSpeaker = useCallback(
    async (speakerTag: number, displayName: string): Promise<void> => {
      if (!client || !meeting) return;
      // 先に画面へ反映する。往復を待たせない。
      setSpeakerNames((current) => new Map(current).set(speakerTag, displayName));
      try {
        await client.nameSpeaker(meeting.id, speakerTag, displayName);
      } catch {
        // 名前は会議の中だけのものなので、失敗しても録音は止めない
      }
    },
    [client, meeting],
  );

  // Dock からの ■ は購読が 1 回なので、最新の stop を参照で持つ
  const stopRef = useRef<() => Promise<void>>(async () => undefined);
  const stop = useCallback(async (): Promise<void> => {
    if (!client || !meeting) return;
    try {
      // 取り込みを先に止め、未送信分を送り切ってから finish へ
      await meetingCapture.stop();
      const { taskId } = await client.finishMeeting(meeting.id);
      setFinalizeTaskId(taskId);
      setPhase('finalizing');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      abort.current?.abort();
      abort.current = null;
    }
  }, [client, meeting]);

  stopRef.current = stop;

  const dismiss = useCallback(() => {
    // finalize は Task Runtime 側で続く。閉じてよい（UI/UX §12.5）。
    setPhase('idle');
    setMeeting(null);
    setView(emptyMeetingView);
    setFinalizeTaskId(null);
    startedAt.current = null;
  }, []);

  useEffect(() => () => abort.current?.abort(), []);

  // Dock（別 window）へ写しを流す。録音の正はここ。Dock は見せるだけ
  const recordingState: RecordingState = paused
    ? 'paused'
    : meeting?.degraded_at
      ? 'degraded'
      : 'recording';
  useEffect(() => {
    void publishMeeting({
      phase,
      state: recordingState,
      title: meeting?.title ?? '会議',
      elapsedMs,
      lines: view.lines.slice(-SNAPSHOT_LINES).map((line) => ({
        id: line.id,
        speakerTag: line.speakerTag,
        text: line.text,
        interim: line.interim,
      })),
      link,
      pendingMs,
    });
  }, [phase, recordingState, meeting?.title, elapsedMs, view.lines, link, pendingMs]);

  // Dock の ■ / ⏸ を受ける
  useEffect(() => {
    let off: (() => void) | null = null;
    let cancelled = false;
    void onMeetingCommand((command) => {
      if (command === 'start') requestStart();
      if (command === 'stop') void stopRef.current();
      if (command === 'pause') setPaused((p) => !p);
    }).then((unlisten) => {
      if (cancelled) unlisten();
      else off = unlisten;
    });
    return () => {
      cancelled = true;
      off?.();
    };
  }, []);

  const value = useMemo<MeetingContextValue>(
    () => ({
      phase,
      meeting,
      view,
      state: recordingState,
      elapsedMs,
      notes,
      speakerNames,
      finalizeTaskId,
      error,
      requestStart,
      cancelStart,
      start,
      setNotes,
      togglePause: () => {
        setPaused((p) => {
          void meetingCapture.setPaused(!p);
          return !p;
        });
      },
      link,
      pendingMs,
      captureError,
      recoverable,
      reupload: async (meetingId: string) => {
        if (!client) return;
        const token = await client.currentAccessToken();
        if (!token) return;
        try {
          await meetingCapture.reupload(meetingId, client.baseUrl, token);
        } catch (cause) {
          setError(cause instanceof Error ? cause.message : String(cause));
        }
        await refreshRecoverable();
      },
      discardRecovery: async (meetingId: string) => {
        await meetingCapture.discard(meetingId);
        await refreshRecoverable();
      },
      nameSpeaker,
      stop,
      dismiss,
    }),
    [
      phase,
      meeting,
      view,
      recordingState,
      elapsedMs,
      notes,
      speakerNames,
      finalizeTaskId,
      error,
      link,
      pendingMs,
      captureError,
      recoverable,
      refreshRecoverable,
      requestStart,
      cancelStart,
      start,
      nameSpeaker,
      stop,
      dismiss,
    ],
  );

  return <MeetingContext.Provider value={value}>{children}</MeetingContext.Provider>;
}

export function useMeeting(): MeetingContextValue {
  const value = useContext(MeetingContext);
  if (!value) throw new Error('useMeeting must be used inside a MeetingProvider');
  return value;
}
