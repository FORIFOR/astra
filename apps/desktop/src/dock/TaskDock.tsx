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
import { WorkCard } from '../work/WorkCard.js';
import type { WorkView } from '../work/workView.js';
import { host, shortcuts } from '../host/tauri.js';
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
  shortcutOverrides = {},
}: {
  initialSources?: readonly ContextSource[];
  /** Settings で変更されたショートカット（§20）。 */
  shortcutOverrides?: BindingOverrides;
  /** Conversation Engine。未接続なら状態遷移だけ行う。 */
  conversation?: DockConversation;
  /** 音声入力。未接続なら LISTENING に入るだけ（正本 §11.1）。 */
  dictation?: DockDictation;
  /** 進行中の仕事。あれば working 面に出す（§6）。 */
  work?: WorkView | null;
  onApprove?(approvalId: string): void;
  onReject?(approvalId: string): void;
  onStop?(): void;
  onOpenWorkspace?(): void;
}): ReactElement {
  const machine = useDockMachine('READY', conversation, dictation);
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

  const geometry = dockGeometryFor(machine.state, machine.contextExpanded);
  const size = dockGeometry[geometry];

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
        // Context Lens に出しているものを一緒に送る（正本 §6）
        machine.submit(referents);
      }
      // Esc と Context Lens は面の全体で受ける（下の window listener）。
      // 入力欄にいるときだけ効く操作にしない。
    },
    [machine, platform, shortcutOverrides],
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

  const statusLabel = useMemo(() => {
    switch (machine.state) {
      case 'LISTENING':
        return '聞いています';
      case 'UNDERSTANDING':
        return '文脈を確認しています';
      case 'WORKING':
        return '進めています';
      default:
        return null;
    }
  }, [machine.state]);

  return (
    <div
      className="astra-dock"
      data-state={machine.state}
      data-geometry={geometry}
      style={{
        ['--astra-dock-width' as string]: `${size.width}px`,
        ['--astra-dock-min-height' as string]: `${size.minHeight}px`,
        ['--astra-dock-max-height' as string]: `${size.maxHeight}px`,
      }}
    >
      <div className="astra-dock__row">
        <span className="astra-dock__mark" aria-hidden="true">
          ✦
        </span>
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
        <button
          type="button"
          className="astra-dock__mic"
          aria-pressed={machine.state === 'LISTENING'}
          onClick={() =>
            machine.state === 'LISTENING' ? machine.stopListening() : machine.startListening()
          }
        >
          <span aria-hidden="true">🎙</span>
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

      {/* §4.1 Listening: live transcript 2 行 + minimal waveform。聞こえていることが見える */}
      {machine.state === 'LISTENING' && (
        <div className="astra-dock__listening" aria-live="polite">
          <span className="astra-dock__wave" aria-hidden="true">
            <i />
            <i />
            <i />
            <i />
            <i />
          </span>
          <p className="astra-dock__transcript">
            {machine.intent.length > 0 ? machine.intent : '…'}
          </p>
        </div>
      )}

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
