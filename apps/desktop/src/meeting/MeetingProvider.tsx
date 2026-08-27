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
  const abort = useRef<AbortController | null>(null);

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

        const controller = new AbortController();
        abort.current = controller;
        void client.streamMeeting(created.id, {
          signal: controller.signal,
          onEvent: (event) => setView((current) => applyMeetingEvent(current, event)),
        });
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
    });
  }, [phase, recordingState, meeting?.title, elapsedMs, view.lines]);

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
      togglePause: () => setPaused((p) => !p),
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
