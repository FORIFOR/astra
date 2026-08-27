/**
 * Task Dock の状態機械。UI/UX §3・§4.4。
 *
 * ここは「何を見せているか」だけを持つ。実行中の Task は Task Runtime 側にあり、
 * Dock を閉じても走り続ける（§4.4）。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { startUxTimer } from '../ux/metrics.js';
import {
  UNDERSTANDING_MAX_MS,
  dockGeometryFor,
  dockPlacementFor,
  escapeOutcome,
  type DockSurface,
  type InteractionState,
} from '@astra/ui-kit';
import { host } from '../host/tauri.js';

/** 上↔下の切替にかける時間。位置移動を全部見せない（黒い帯が画面を横切る）。 */
export const DOCK_FADE_OUT_MS = 80;
export const DOCK_FADE_IN_MS = 120;
/** 「会議を保存しました」を見せる時間。 */
export const PROCESSING_MS = 900;

export interface DockMachine {
  readonly state: InteractionState;
  /** ピル（上部の細い入口）か、入力カードか。 */
  readonly surface: DockSurface;
  /** 上↔下の切替中。`out` は消えかけ、`in` は現れかけ。 */
  readonly transition: 'out' | 'in' | null;
  readonly contextExpanded: boolean;
  readonly intent: string;
  /** ピル → 入力カード（Option+Space / クリック）。 */
  expand(): void;
  /** ピルを押した。クイックメニュー（文字で頼む / 声で頼む / 会議を記録）。 */
  openMenu(): void;
  /** 会議が始まった。下部の Recording Dock へ。 */
  enterRecording(): void;
  /** 会議が止まった。「保存しました」を見せてからピルへ戻る。 */
  leaveRecording(): void;
  /** 入力カード → ピル。**仕事は止めない。** */
  collapse(): void;
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
  initialSurface: DockSurface = initial === 'IDLE' ? 'pill' : 'card',
): DockMachine {
  const [state, setState] = useState<InteractionState>(initial);
  const [surface, setSurface] = useState<DockSurface>(initialSurface);
  const [transition, setTransition] = useState<'out' | 'in' | null>(null);
  const lastPlacement = useRef(dockPlacementFor(dockGeometryFor(initial, false, initialSurface)));
  const [contextExpanded, setContextExpanded] = useState(false);
  const [intent, setIntentValue] = useState('');
  /** 聞き返し。解決できない指示語があったときだけ入る。 */
  const [clarification, setClarification] = useState<string | null>(null);
  // 「1 回目の Esc で何かを縮めたか」。2 回目の判定に使う。
  const shrunk = useRef(false);

  // window の形は状態に従う。ここを忘れると中身と枠がずれる。
  // 上↔下は、消してから置いて、出す（画面の真ん中を横切らせない）。
  useEffect(() => {
    const geometry = dockGeometryFor(state, contextExpanded, surface);
    const placement = dockPlacementFor(geometry);
    if (placement === lastPlacement.current) {
      void host.setDockState(geometry);
      return;
    }
    lastPlacement.current = placement;
    setTransition('out');
    const out = setTimeout(() => {
      void host.setDockState(geometry, undefined, true);
      setTransition('in');
    }, DOCK_FADE_OUT_MS);
    const settle = setTimeout(() => setTransition(null), DOCK_FADE_OUT_MS + DOCK_FADE_IN_MS);
    return () => {
      clearTimeout(out);
      clearTimeout(settle);
    };
  }, [state, contextExpanded, surface]);

  const collapse = useCallback(() => {
    setState('IDLE');
    setSurface('pill');
    setContextExpanded(false);
    shrunk.current = false;
  }, []);

  const enterRecording = useCallback(() => {
    setState('RECORDING');
    setSurface('pill');
    setContextExpanded(false);
  }, []);

  const leaveRecording = useCallback(() => {
    setState((current) => (current === 'RECORDING' ? 'PROCESSING' : current));
    setTimeout(() => {
      setState((current) => {
        if (current !== 'PROCESSING') return current;
        setSurface('pill');
        return 'IDLE';
      });
    }, PROCESSING_MS);
  }, []);

  const openMenu = useCallback(() => {
    setState('IDLE');
    setSurface('menu');
  }, []);

  const expand = useCallback(() => {
    setSurface('card');
    setState((current) => (current === 'IDLE' ? 'READY' : current));
    shrunk.current = false;
    void host.focusDock();
  }, []);

  // Option+Space: ピル ↔ カード。録音中は何もしない（■ で止める）
  useEffect(() => {
    let off: (() => void) | null = null;
    let cancelled = false;
    void host
      .onDockToggle(() => {
        setState((current) => {
          if (current === 'RECORDING' || current === 'PROCESSING') return current;
          if (current === 'IDLE') {
            setSurface('card');
            void host.focusDock();
            return 'READY';
          }
          setSurface('pill');
          setContextExpanded(false);
          return 'IDLE';
        });
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

  const setIntent = useCallback((value: string) => {
    setIntentValue(value);
    setState((current) => {
      if (current === 'LISTENING') return current;
      return value.length > 0 ? 'TYPING' : 'READY';
    });
  }, []);

  const dismiss = useCallback(() => {
    // 実行中の Task はそのまま。Dismiss と Cancel を同じ操作にしない（§4.4）。
    // 消えるのではなく、いちばん静かな姿（上部のピル）に戻る
    collapse();
  }, [collapse]);

  const escape = useCallback(() => {
    /*
     * 聞いている最中の Esc は、まず聞くのをやめる。
     * 畳んだ Dock の裏でマイクが開いたままだと、利用者には止まったように見えて
     * 録り続ける（実機で確認: HUD が「聞いています」のまま残った）。
     */
    if (state === 'LISTENING') {
      void dictation?.stop().catch(() => undefined);
      if (surface === 'pill') {
        collapse();
        return;
      }
      setState(intent.length > 0 ? 'TYPING' : 'READY');
      shrunk.current = true;
      return;
    }
    const outcome = escapeOutcome(dockGeometryFor(state, contextExpanded, surface), shrunk.current);
    if (outcome === 'ignored') return;
    if (outcome === 'shrink') {
      shrunk.current = true;
      if (contextExpanded) setContextExpanded(false);
      else setState('MINIMIZED');
      return;
    }
    dismiss();
  }, [state, contextExpanded, dismiss, dictation, intent, surface, collapse]);

  /** ピルで聞き終えたら、そのまま送る（声の依頼は Enter を待たない）。 */
  const submitRef = useRef<(referents?: readonly ContextReferent[]) => void>(() => undefined);

  return {
    state,
    surface,
    transition,
    contextExpanded,
    intent,
    setIntent,
    expand,
    openMenu,
    collapse,
    enterRecording,
    leaveRecording,
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
      if (surface === 'pill') {
        // ピルで聞いた声は、そのまま依頼になる。何も聞き取れなければ静かに戻る
        if (intent.trim().length > 0) submitRef.current([]);
        else setState('IDLE');
        return;
      }
      setState(intent.length > 0 ? 'TYPING' : 'READY');
    },
    submit: (submitRef.current = (referents = []) => {
      const text = intent.trim();
      if (text.length === 0) return;
      shrunk.current = false;
      // §3: UNDERSTANDING は 0.3〜1.2 秒程度の短い status。
      setState('UNDERSTANDING');

      // 未接続なら状態だけ動かす（Conversation Engine が無い構成）。
      // ただし「考えています」のまま置き去りにしない。§3 の上限で戻して、理由を言う
      if (!conversation) {
        setTimeout(() => {
          setState((current) => {
            if (current !== 'UNDERSTANDING') return current;
            setSurface('card');
            setClarification('まだ接続していません。サインインすると頼めます。');
            return 'READY';
          });
        }, UNDERSTANDING_MAX_MS);
        return;
      }

      // §23: 長い仕事の受け付け（< 1 s）。返事が来た時点で止める
      const acknowledged = startUxTimer('long_task_ack');
      void conversation
        .send(text, referents)
        .then((result) => {
          acknowledged();
          /*
           * 指示語が解けなかったときは、**進めずに聞き返す**。
           * ここで THINKING へ進めると、利用者が指したものとは
           * 別のものに対して動き出す（正本 §7.2、D-49）。
           */
          // 返事はピルには収まらない。ここでカードに広がる（Esc でピルへ戻る）
          setSurface('card');
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
          setSurface('card');
          setClarification(error instanceof Error ? error.message : String(error));
          setState('READY');
        });
    }),
    toggleContext: () => {
      shrunk.current = false;
      setContextExpanded((v) => !v);
    },
    clarification,
    escape,
    dismiss,
  };
}
