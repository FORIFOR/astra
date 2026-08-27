/**
 * Task Dock の状態機械。UI/UX §3・§4.4。
 *
 * ここは「何を見せているか」だけを持つ。実行中の Task は Task Runtime 側にあり、
 * Dock を閉じても走り続ける（§4.4）。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { dockGeometryFor, escapeOutcome, type InteractionState } from '@astra/ui-kit';
import { host } from '../host/tauri.js';

export interface DockMachine {
  readonly state: InteractionState;
  readonly contextExpanded: boolean;
  readonly intent: string;
  setIntent(value: string): void;
  startListening(): void;
  stopListening(): void;
  /** 送る。Context Lens が出しているものを一緒に渡す（正本 §6）。 */
  submit(referents?: readonly ContextReferent[]): void;
  /** 聞き返しの文面。無ければ null。 */
  readonly clarification: string | null;
  toggleContext(): void;
  /** Esc。1 回目は縮小、2 回目で dismiss。**Task は止めない**。 */
  escape(): void;
  dismiss(): void;
}

/** 画面に出ていて、指示語の解決先になり得るもの（正本 §6）。 */
export interface ContextReferent {
  readonly label: string;
  readonly kind: string;
}

/** Conversation Engine へ渡す口。未接続なら状態遷移だけを行う。 */
export interface DockConversation {
  send(
    text: string,
    referents: readonly ContextReferent[],
  ): Promise<{
    needsClarification: boolean;
    answer: string | null;
    taskId?: string | null;
    notice?: string | null;
  }>;
}

/**
 * 音声入力の口。正本 §11.1。
 *
 * **Dock は音を持たない。**取り込みと認識は外（`@astra/stt`）でやり、
 * ここへは確定した文字だけが来る。Dock に音の扱いを持ち込むと、
 * 「どこでクラウドへ出ているか」が追えなくなる。
 */
export interface DockDictation {
  start(handlers: { onPartial(text: string): void; onFinal(text: string): void }): Promise<void>;
  stop(): Promise<void>;
}

export function useDockMachine(
  initial: InteractionState = 'READY',
  conversation?: DockConversation,
  dictation?: DockDictation,
): DockMachine {
  const [state, setState] = useState<InteractionState>(initial);
  const [contextExpanded, setContextExpanded] = useState(false);
  const [intent, setIntentValue] = useState('');
  /** 聞き返し。解決できない指示語があったときだけ入る。 */
  const [clarification, setClarification] = useState<string | null>(null);
  // 「1 回目の Esc で何かを縮めたか」。2 回目の判定に使う。
  const shrunk = useRef(false);

  // window の形は状態に従う。ここを忘れると中身と枠がずれる。
  useEffect(() => {
    void host.setDockState(dockGeometryFor(state, contextExpanded));
  }, [state, contextExpanded]);

  const setIntent = useCallback((value: string) => {
    setIntentValue(value);
    setState((current) => {
      if (current === 'LISTENING') return current;
      return value.length > 0 ? 'TYPING' : 'READY';
    });
  }, []);

  const dismiss = useCallback(() => {
    // 実行中の Task はそのまま。Dismiss と Cancel を同じ操作にしない（§4.4）
    setState('HIDDEN');
    setContextExpanded(false);
    shrunk.current = false;
    void host.hideDock();
  }, []);

  const escape = useCallback(() => {
    /*
     * 聞いている最中の Esc は、まず聞くのをやめる。
     * 畳んだ Dock の裏でマイクが開いたままだと、利用者には止まったように見えて
     * 録り続ける（実機で確認: HUD が「聞いています」のまま残った）。
     */
    if (state === 'LISTENING') {
      void dictation?.stop().catch(() => undefined);
      setState(intent.length > 0 ? 'TYPING' : 'READY');
      shrunk.current = true;
      return;
    }
    const outcome = escapeOutcome(dockGeometryFor(state, contextExpanded), shrunk.current);
    if (outcome === 'shrink') {
      shrunk.current = true;
      if (contextExpanded) setContextExpanded(false);
      else setState('MINIMIZED');
      return;
    }
    dismiss();
  }, [state, contextExpanded, dismiss, dictation, intent]);

  return {
    state,
    contextExpanded,
    intent,
    setIntent,
    startListening: () => {
      shrunk.current = false;
      if (!dictation) {
        /*
         * 音声入力が繋がっていない。**聞いているふりをしない。**
         * LISTENING に入って何も起きないと、利用者は喋り続けて待つことになる。
         * できないことは、できないと言う（UI/UX §21・§25）。
         */
        setClarification('音声入力はこの端末ではまだ使えません。文字で頼んでください。');
        return;
      }
      setState('LISTENING');

      void dictation
        .start({
          // 途中経過はそのまま入力欄へ。確定したら入れ替える（§4.3）。
          onPartial: (text) => setIntentValue(text),
          onFinal: (text) => setIntentValue(text),
        })
        .catch((error: unknown) => {
          // 聞けなかったことを黙って飲み込まない
          setClarification(error instanceof Error ? error.message : String(error));
          setState('READY');
        });
    },
    stopListening: () => {
      void dictation?.stop().catch(() => undefined);
      setState(intent.length > 0 ? 'TYPING' : 'READY');
    },
    submit: (referents = []) => {
      const text = intent.trim();
      if (text.length === 0) return;
      shrunk.current = false;
      // §3: UNDERSTANDING は 0.3〜1.2 秒程度の短い status。
      setState('UNDERSTANDING');

      // 未接続なら状態だけ動かす（Conversation Engine が無い構成）
      if (!conversation) return;

      void conversation
        .send(text, referents)
        .then((result) => {
          /*
           * 指示語が解けなかったときは、**進めずに聞き返す**。
           * ここで THINKING へ進めると、利用者が指したものとは
           * 別のものに対して動き出す（正本 §7.2、D-49）。
           */
          if (result.needsClarification) {
            setClarification(result.answer);
            setState('READY');
            return;
          }
          if (!result.taskId && result.notice) {
            setClarification(result.notice);
            setState('READY');
            return;
          }
          setClarification(null);
          setIntentValue('');
          setState('WORKING');
        })
        .catch((error: unknown) => {
          // 黙って READY に戻さない。何が起きたか言う（UI/UX §21）。
          setClarification(error instanceof Error ? error.message : String(error));
          setState('READY');
        });
    },
    toggleContext: () => {
      shrunk.current = false;
      setContextExpanded((v) => !v);
    },
    clarification,
    escape,
    dismiss,
  };
}
