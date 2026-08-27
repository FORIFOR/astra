/**
 * Task Dock。UI/UX §4。
 *
 * Chat 画面ではなく Intent Bar。Voice / Text / 画面 / 選択範囲 / ファイルを
 * 同一 Conversation へ入れる入口。
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import {
  DOCK_MAX_INPUT_LINES,
  currentPlatform,
  dockGeometry,
  dockGeometryFor,
  isComposing,
  resolveShortcut,
  type BindingOverrides,
} from '@astra/ui-kit';
import type { ContextSource } from '@astra/contracts';
import { useDockMachine, type DockConversation, type DockDictation } from './useDockMachine.js';
import { ContextLens } from './ContextLens.js';
import { PermissionAsk } from './PermissionAsk.js';
import { ResultPreview } from './ResultPreview.js';
import { WorkCard } from '../work/WorkCard.js';
import { AstraOrb, useAccentHex } from '../voice/AstraOrb.js';
import { MicIcon } from '../voice/MicIcon.js';
import type { VoiceMode } from '../voice/voiceRuntime.js';
import type { DockSurface, InteractionState } from '@astra/ui-kit';
import { DockPill } from './DockPill.js';
import { QuickMenu } from './QuickMenu.js';
import { ProcessingDock, RecordingDock } from './RecordingDock.js';
import type { MeetingCommand, MeetingSnapshot } from '../meeting/meetingBridge.js';
import { dockVoiceMode, voiceModeLabel } from './dockVoiceMode.js';
import { LiveWaveform } from '../vendor/deepgram-ui/LiveWaveform.js';
import type { WorkView } from '../work/workView.js';
import { host, shortcuts, workspace } from '../host/tauri.js';
import '../work/work.css';

export function TaskDock({
  initialSources = [],
  work = null,
  onApprove,
  onReject,
  onStop,
  onOpenWorkspace,
  conversation,
  dictation,
  voiceLevels,
  voiceMode = 'idle',
  initialState = 'READY',
  initialSurface,
  voiceUnavailable,
  onRequestSubmitted,
  resultText,
  notice = null,
  shortcutOverrides = {},
  meeting = null,
  onMeetingCommand,
}: {
  /** main window の録音の写し。live なら Dock は下へ降りて Recording Dock になる。 */
  meeting?: MeetingSnapshot | null;
  onMeetingCommand?(command: MeetingCommand): void;
  initialSources?: readonly ContextSource[];
  /** Settings で変更されたショートカット（§20）。 */
  shortcutOverrides?: BindingOverrides;
  /** Conversation Engine。未接続なら状態遷移だけ行う。 */
  conversation?: DockConversation;
  /** 音声入力。未接続なら mic は「使えない」と言う（正本 §11.1、UI/UX §21）。 */
  dictation?: DockDictation;
  /** Orb と波形が読む音量。frame ごとに読むので getter で渡す。 */
  voiceLevels?: { input: () => number; output: () => number };
  /** 音声 runtime の姿（読み上げ中など）。Orb はこれと対話状態を畳んだ姿になる。 */
  voiceMode?: VoiceMode;
  /** 最初の状態。見た目の確認用（demo）にだけ使う。 */
  initialState?: InteractionState;
  /** 最初の面。demo で「ピルのまま聞いている」を出すため。 */
  initialSurface?: DockSurface;
  /** 端末内 STT / Google 確定が使えない理由。 */
  voiceUnavailable?: string | null;
  /** true の発話だけ、停止後の PCM を Google Chirp 3 へ送る。 */
  /** voice turn なら Voice HUD を thinking へ進める。 */
  onRequestSubmitted?(): void;
  /** 完了した成果物の本文。Dock 内の result sheet に出す。 */
  resultText?: string | null;
  /** 承認の返事が通らなかった等、その場で伝える一言（§21）。 */
  notice?: string | null;
  /** 進行中の仕事。あれば working 面に出す（§6）。 */
  work?: WorkView | null;
  onApprove?(approvalId: string): void;
  onReject?(approvalId: string): void;
  onStop?(): void;
  onOpenWorkspace?(): void;
}): ReactElement {
  const machine = useDockMachine(
    initialState,
    conversation,
    dictation,
    initialSurface ?? (initialState === 'IDLE' ? 'pill' : 'card'),
  );
  const [sources, setSources] = useState<readonly ContextSource[]>(initialSources);
  const [explanation, setExplanation] = useState<string | null>(null);
  /*
   * 取れなかった文脈と、その理由。§22: 使う直前に purpose-first で聞く。
   * **黙って落とさない。**落とすと、Context Lens は「見たもの」ではなく
   * 「たまたま見えたもの」になる。
   */
  const [missingPermissions, setMissingPermissions] = useState<readonly string[]>([]);

  // 前面アプリを文脈として取り込む。取れなければ何も足さない（推測で埋めない）。
  useEffect(() => {
    let cancelled = false;
    void host.contextSnapshot().then((snapshot) => {
      if (cancelled || !snapshot) return;
      setMissingPermissions(snapshot.requires_permission);
      if (!snapshot.active_app) return;
      setSources((current) =>
        current.some((s) => s.id === 'current-app')
          ? current
          : [
              {
                id: 'current-app',
                category: 'current',
                label: snapshot.active_app!,
                reason: '今このアプリを操作しているため',
                sensitivity: 'PRIVATE',
                removable: true,
                used: false,
              },
              ...current,
            ],
      );
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const [attachOpen, setAttachOpen] = useState(false);
  const filePicker = useRef<HTMLInputElement>(null);

  /** 文脈を 1 つ足す。同じものは二度足さない。 */
  const addSource = useCallback((id: string, label: string, reason: string) => {
    setSources((current) =>
      current.some((s) => s.id === id)
        ? current
        : [
            {
              id,
              category: 'current',
              label,
              reason,
              sensitivity: 'PRIVATE',
              removable: true,
              used: false,
            },
            ...current,
          ],
    );
    setAttachOpen(false);
  }, []);

  /**
   * 画面 / 選択を添える。取れるのは前面の app と窓の題名まで。
   * **取れなかったら足さない**（推測で埋めない）。足せなかったことは言う。
   */
  const attachFromScreen = useCallback(
    async (what: 'screen' | 'selection') => {
      const snapshot = await host.contextSnapshot();
      const label = snapshot?.window_title ?? snapshot?.active_app ?? null;
      if (!label) {
        setExplanation('いまの画面を読み取れませんでした。');
        setAttachOpen(false);
        return;
      }
      addSource(
        `${what}:${label}`,
        label,
        what === 'screen' ? 'いまの画面として添えたため' : '選択しているものとして添えたため',
      );
    },
    [addSource],
  );

  const geometry = dockGeometryFor(machine.state, machine.contextExpanded, machine.surface);
  const size = dockGeometry[geometry];

  // 録音は main の状態に従う。live で降り、止まったら「保存しました」を経てピルへ
  const phase = meeting?.phase ?? 'idle';
  useEffect(() => {
    if (phase === 'live') machine.enterRecording();
    else if (phase === 'finalizing' || phase === 'idle') machine.leaveRecording();
    // machine の関数は安定している。phase が変わったときだけ
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  // 中身の高さで window を伸ばす（min..max の範囲を持つ面だけ）
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (size.minHeight === size.maxHeight || !root.current) return;
    const el = root.current;
    const observer = new ResizeObserver(() => {
      void host.setDockState(geometry, Math.ceil(el.getBoundingClientRect().height));
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [geometry, size.minHeight, size.maxHeight]);

  const platform = useMemo(() => currentPlatform(), []);

  /*
   * 指示語の解決先。**Context Lens が見せているものと同じにする。**
   * 見せているのに送らないと、利用者からは「画面に出ているのに聞き返された」
   * ように見える（正本 §6、§30 Case A）。
   */
  const referents = useMemo(
    () => sources.map((source) => ({ label: source.label, kind: source.category })),
    [sources],
  );

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
      /*
       * **変換確定の Enter を送信にしない。**日本語入力では Enter が
       * 「変換を確定する」キーでもある。ここを見落とすと、
       * 変換途中の文がそのまま依頼として送られる（§20）。
       */
      if (isComposing(event.nativeEvent)) return;

      // §4.3: Enter 送信 / Shift+Enter 改行 / Cmd-Ctrl+Enter でも送信
      const hit = resolveShortcut(event, platform, shortcutOverrides, 'surface');
      if (hit === 'dock.send') {
        event.preventDefault();
        if (machine.intent.trim().length > 0) onRequestSubmitted?.();
        // Context Lens に出しているものを一緒に送る（正本 §6）
        machine.submit(referents);
      }
      // Esc と Context Lens は面の全体で受ける（下の window listener）。
      // 入力欄にいるときだけ効く操作にしない。
    },
    [machine, onRequestSubmitted, platform, referents, shortcutOverrides],
  );

  /*
   * §20 の「面に効く」ショートカット。**入力欄に focus が無くても効く。**
   * 承認ボタンに focus があるときに Esc が死ぬと、閉じ方が分からなくなる。
   */
  useEffect(() => {
    const handle = (event: KeyboardEvent): void => {
      if (isComposing(event)) return;
      const hit = resolveShortcut(event, platform, shortcutOverrides, 'surface');
      if (hit === 'surface.dismiss') {
        event.preventDefault();
        machine.escape();
        return;
      }
      if (hit === 'context.open') {
        event.preventDefault();
        machine.toggleContext();
      }
    };
    window.addEventListener('keydown', handle);
    return () => window.removeEventListener('keydown', handle);
  }, [machine, platform, shortcutOverrides]);

  /*
   * Push-to-talk（§20「shortcut hold」）。押している間だけ聞く。
   * **離したら必ず止める。**止め損ねると、押していないのに録り続ける。
   */
  useEffect(() => {
    let stop: (() => void) | null = null;
    let cancelled = false;
    void shortcuts
      .onHold((id, pressed) => {
        if (id !== 'dock.pushToTalk') return;
        if (pressed) machine.startListening();
        else machine.stopListening();
      })
      .then((unlisten) => {
        if (cancelled) unlisten();
        else stop = unlisten;
      });
    return () => {
      cancelled = true;
      stop?.();
    };
  }, [machine]);

  const removeSource = useCallback((id: string) => {
    // §5.2: remove したら plan を再評価する。UI-2 で Conversation Engine へ通知する。
    setSources((current) => current.filter((s) => s.id !== id));
    setExplanation(null);
  }, []);

  const explain = useCallback(
    (id: string) => {
      const source = sources.find((s) => s.id === id);
      setExplanation(source?.reason ?? null);
    },
    [sources],
  );

  // 聞き返しは、進める代わりに出る。**黙って別のものに対して動かない。**
  const clarification = machine.clarification;

  // Orb の姿。Deepgram の floating-orb と同じ語彙（idle / connecting / listening / thinking / speaking）。
  const orbMode = dockVoiceMode(machine.state, voiceMode);
  const accent = useAccentHex();
  const listening = machine.state === 'LISTENING';
  const toggleListening = (): void =>
    listening ? machine.stopListening() : machine.startListening();

  // 一言は HUD と同じ語彙。WORKING だけは音声ではなく仕事の言葉。
  const statusLabel = useMemo(
    () => (machine.state === 'WORKING' ? '進めています' : voiceModeLabel(orbMode)),
    [machine.state, orbMode],
  );

  const frameStyle = {
    ['--astra-dock-width' as string]: `${size.width}px`,
    ['--astra-dock-min-height' as string]: `${size.minHeight}px`,
    ['--astra-dock-max-height' as string]: `${size.maxHeight}px`,
  };

  // 録音中: 下部の Recording Dock。停止直後は「保存しました」
  if (machine.state === 'RECORDING' || machine.state === 'PROCESSING') {
    return (
      <div
        ref={root}
        className="astra-dock astra-dock--recording"
        data-state={machine.state}
        data-surface="pill"
        data-geometry={geometry}
        data-transition={machine.transition ?? undefined}
        style={frameStyle}
      >
        {machine.state === 'RECORDING' && meeting ? (
          <RecordingDock
            meeting={meeting}
            onStop={() => onMeetingCommand?.('stop')}
            onPause={() => onMeetingCommand?.('pause')}
          />
        ) : (
          <ProcessingDock />
        )}
      </div>
    );
  }

  // ピルを押したときのクイックメニュー。通常は閉じている
  if (machine.state === 'IDLE' && machine.surface === 'menu') {
    return (
      <div
        className="astra-dock astra-dock--menu"
        data-state={machine.state}
        data-surface="menu"
        data-geometry={geometry}
        style={frameStyle}
      >
        <QuickMenu
          onAsk={machine.expand}
          onListen={() => {
            machine.collapse();
            machine.startListening();
          }}
          onRecord={() => {
            machine.collapse();
            // 先に本体を前に出す（Work タブへ移る）。その後で開始確認を頼む。
            // 逆にすると、タブ移動が「開始確認を閉じる」扱いになって消える
            void workspace.open().then(() => {
              setTimeout(() => onMeetingCommand?.('start'), 150);
            });
          }}
          onClose={machine.collapse}
        />
      </div>
    );
  }

  // ピル: 上部の細い入口。入力欄は持たない。押すか Option+Space でカードに広がる。
  // IDLE は面の値に関わらずピル（32px の枠にカードを押し込まない）
  if (machine.surface === 'pill' || machine.state === 'IDLE') {
    return (
      <div
        className="astra-dock astra-dock--pill"
        data-state={machine.state}
        data-surface="pill"
        data-geometry={geometry}
        data-transition={machine.transition ?? undefined}
        style={frameStyle}
      >
        <DockPill
          state={machine.state}
          orbMode={orbMode}
          intent={machine.intent}
          {...(voiceLevels ? { voiceLevels } : {})}
          onOpen={machine.state === 'IDLE' ? machine.openMenu : machine.expand}
        />
      </div>
    );
  }

  return (
    <div
      ref={root}
      className="astra-dock"
      data-state={machine.state}
      data-surface="card"
      data-geometry={geometry}
      data-transition={machine.transition ?? undefined}
      style={frameStyle}
    >
      <div className="astra-dock__row">
        {/*
          Orb そのものが入口（Deepgram の floating-orb）。idle でも見え、押すと聞き始める。
          姿は data-astra-voice-state で公開し、CSS だけで差し替えられるようにしておく。
        */}
        <button
          type="button"
          className="astra-dock__orb"
          data-astra-voice-state={orbMode}
          aria-pressed={listening}
          aria-label={listening ? '聞くのをやめる' : 'Astra に話しかける'}
          onClick={toggleListening}
        >
          <AstraOrb
            mode={orbMode}
            size={28}
            {...(voiceLevels
              ? { getInputVolume: voiceLevels.input, getOutputVolume: voiceLevels.output }
              : {})}
          />
        </button>
        <textarea
          className="astra-dock__intent"
          // §4.3: 機能例を常時ローテーションしない
          placeholder="何をしますか？"
          aria-label="依頼を入力"
          rows={Math.min(DOCK_MAX_INPUT_LINES, Math.max(1, machine.intent.split('\n').length))}
          value={machine.intent}
          onChange={(event) => machine.setIntent(event.target.value)}
          onKeyDown={onKeyDown}
        />
        {listening && (
          <p className="astra-dock__transcript" aria-live="polite">
            {machine.intent.length > 0 ? machine.intent : '聞いています…'}
          </p>
        )}
        <button
          type="button"
          className="astra-dock__mic"
          data-astra-voice-state={orbMode}
          aria-pressed={listening}
          onClick={toggleListening}
        >
          <MicIcon muted={orbMode === 'error'} />
          <span className="astra-visually-hidden">
            {machine.state === 'LISTENING' ? '音声入力を止める' : '音声で入力する'}
          </span>
        </button>
        <button
          type="button"
          className="astra-dock__attach"
          aria-expanded={attachOpen}
          aria-haspopup="menu"
          onClick={() => setAttachOpen((open) => !open)}
        >
          <span aria-hidden="true">＋</span>
          {/* §4.3: 技術的な tool 一覧は出さない */}
          <span className="astra-visually-hidden">ファイルや画面を追加する</span>
        </button>
        <input
          ref={filePicker}
          type="file"
          className="astra-visually-hidden"
          tabIndex={-1}
          aria-hidden="true"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) addSource(`file:${file.name}`, file.name, '手で添えたファイルのため');
            event.target.value = '';
          }}
        />
      </div>

      {/* §4.3: Attach + = File / Screen / Selection の明示追加。押しても何も起きない + を残さない */}
      {attachOpen && (
        <ul className="astra-dock__attach-menu" role="menu" aria-label="何を添えるか">
          <li role="none">
            <button type="button" role="menuitem" onClick={() => filePicker.current?.click()}>
              ファイル
            </button>
          </li>
          <li role="none">
            <button type="button" role="menuitem" onClick={() => void attachFromScreen('screen')}>
              いまの画面
            </button>
          </li>
          <li role="none">
            <button
              type="button"
              role="menuitem"
              onClick={() => void attachFromScreen('selection')}
            >
              選択しているもの
            </button>
          </li>
        </ul>
      )}

      {/* 聞き返しは、進める代わりに出る。**黙って別のものに対して動かない。** */}
      {clarification && (
        <p className="astra-dock__clarification" role="alert">
          {clarification}
        </p>
      )}

      {statusLabel && !work && (
        <p className="astra-dock__status" role="status">
          {statusLabel}
        </p>
      )}

      {/*
        §4.1 Listening: live transcript 2 行 + minimal waveform。
        描画は Deepgram 公式の Orb / LiveWaveform（`vendor/deepgram-ui`）。
        音量は Rust の取り込みから来る。**音量が来なければ Orb は動かない** —
        動いていないのは、聞こえていない印。
      */}
      {machine.state === 'LISTENING' && (
        <div className="astra-dock__listening">
          <div className="astra-dock__listening-body">
            <div className="astra-dock__wave">
              <LiveWaveform
                active
                color={accent}
                getVolume={voiceLevels ? voiceLevels.input : () => 0}
              />
            </div>
          </div>
        </div>
      )}

      {voiceUnavailable && machine.state !== 'LISTENING' && (
        <p className="astra-dock__voice-error" role="alert">
          {voiceUnavailable}
        </p>
      )}

      {notice && (
        <p className="astra-dock__voice-error" role="alert">
          {notice}
        </p>
      )}
      {resultText && <ResultPreview text={resultText} />}

      {/* §4.4: 簡単な返事のために full app へ遷移しない。進行は Dock の中で見せる。 */}
      {work && geometry === 'working' && (
        <WorkCard
          view={work}
          {...(onApprove ? { onApprove } : {})}
          {...(onReject ? { onReject } : {})}
          {...(onStop ? { onStop } : {})}
          {...(onOpenWorkspace ? { onOpen: onOpenWorkspace } : {})}
        />
      )}

      {/* §22: まとめて求めない。使う直前に、目的を先に言って聞く。 */}
      <PermissionAsk missing={missingPermissions} />

      <ContextLens
        sources={sources}
        expanded={machine.contextExpanded}
        onToggle={machine.toggleContext}
        onRemove={removeSource}
        onWhy={explain}
        explanation={explanation}
      />
    </div>
  );
}
