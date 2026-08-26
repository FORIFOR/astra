/**
 * タスクの進行を購読する。UI/UX §6、実装仕様 §7.3。
 *
 * 接続の面倒（再接続・欠番・重複）は `@astra/api-client` が見る。
 * ここは受け取ったイベントを view へ畳み込むだけにして、
 * 画面のコードに再接続のロジックを持ち込まない。
 */
import { useEffect, useState } from 'react';
import type { AstraClient } from '@astra/api-client';
import { applyEvent, emptyWorkView, type WorkView } from './workView.js';

export interface TaskStreamState {
  readonly view: WorkView;
  /** 再接続中か。UI/UX §21「接続が切れました。ローカル作業は継続中。」 */
  readonly reconnecting: boolean;
}

export function useTaskStream(client: AstraClient | null, taskId: string | null): TaskStreamState {
  const [view, setView] = useState<WorkView>(emptyWorkView);
  const [reconnecting, setReconnecting] = useState(false);

  useEffect(() => {
    if (!client || !taskId) {
      setView(emptyWorkView);
      return;
    }
    const controller = new AbortController();
    setView(emptyWorkView);
    setReconnecting(false);

    void client.streamTask(taskId, {
      signal: controller.signal,
      onEvent: (event) => {
        setReconnecting(false);
        setView((current) => applyEvent(current, event));
      },
      onReconnect: () => setReconnecting(true),
    });

    return () => controller.abort();
  }, [client, taskId]);

  return { view, reconnecting };
}
