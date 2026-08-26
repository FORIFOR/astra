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
  submit(): void;
  toggleContext(): void;
  /** Esc。1 回目は縮小、2 回目で dismiss。**Task は止めない**。 */
  escape(): void;
  dismiss(): void;
}

export function useDockMachine(initial: InteractionState = 'READY'): DockMachine {
  const [state, setState] = useState<InteractionState>(initial);
  const [contextExpanded, setContextExpanded] = useState(false);
  const [intent, setIntentValue] = useState('');
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
    const outcome = escapeOutcome(dockGeometryFor(state, contextExpanded), shrunk.current);
    if (outcome === 'shrink') {
      shrunk.current = true;
      if (contextExpanded) setContextExpanded(false);
      else setState('MINIMIZED');
      return;
    }
    dismiss();
  }, [state, contextExpanded, dismiss]);

  return {
    state,
    contextExpanded,
    intent,
    setIntent,
    startListening: () => {
      shrunk.current = false;
      setState('LISTENING');
    },
    stopListening: () => setState(intent.length > 0 ? 'TYPING' : 'READY'),
    submit: () => {
      if (intent.trim().length === 0) return;
      shrunk.current = false;
      // §3: UNDERSTANDING は 0.3〜1.2 秒程度の短い status。
      // 実際の遷移は Conversation Engine 接続後（UI-2）に置き換える。
      setState('UNDERSTANDING');
    },
    toggleContext: () => {
      shrunk.current = false;
      setContextExpanded((v) => !v);
    },
    escape,
    dismiss,
  };
}
