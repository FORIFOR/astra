/**
 * Task Dock。UI/UX §4。
 *
 * Chat 画面ではなく Intent Bar。Voice / Text / 画面 / 選択範囲 / ファイルを
 * 同一 Conversation へ入れる入口。
 */
import { useCallback, useEffect, useMemo, useState, type ReactElement } from 'react';
import { DOCK_MAX_INPUT_LINES, dockGeometry, dockGeometryFor } from '@astra/ui-kit';
import type { ContextSource } from '@astra/contracts';
import { useDockMachine, type DockConversation, type DockDictation } from './useDockMachine.js';
import { ContextLens } from './ContextLens.js';
import { WorkCard } from '../work/WorkCard.js';
import type { WorkView } from '../work/workView.js';
import { host } from '../host/tauri.js';
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
}: {
  initialSources?: readonly ContextSource[];
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

  // 前面アプリを文脈として取り込む。取れなければ何も足さない（推測で埋めない）。
  useEffect(() => {
    let cancelled = false;
    void host.contextSnapshot().then((snapshot) => {
      if (cancelled || !snapshot?.active_app) return;
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

  const geometry = dockGeometryFor(machine.state, machine.contextExpanded);
  const size = dockGeometry[geometry];

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        machine.escape();
        return;
      }
      // §4.3: Enter 送信 / Shift+Enter 改行 / Cmd-Ctrl+Enter でも送信
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        machine.submit();
      }
    },
    [machine],
  );

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
        <button type="button" className="astra-dock__attach">
          <span aria-hidden="true">＋</span>
          {/* §4.3: 技術的な tool 一覧は出さない */}
          <span className="astra-visually-hidden">ファイルや画面を追加する</span>
        </button>
      </div>

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
