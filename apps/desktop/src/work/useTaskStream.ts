/**
 * タスクの進行を購読する。UI/UX §6、実装仕様 §7.3。
 *
 * 接続の面倒（再接続・欠番・重複）は `@astra/api-client` が見る。
 * ここは受け取ったイベントを view へ畳み込むだけにして、
 * 画面のコードに再接続のロジックを持ち込まない。
 */
import { useEffect, useState } from 'react';
import type { AstraClient } from '@astra/api-client';
import type { Task } from '@astra/contracts';
import { applyEvent, emptyWorkView, isTerminal, seedWorkView, type WorkView } from './workView.js';

export interface TaskStreamState {
  readonly view: WorkView;
  /** 再接続中か。UI/UX §21「接続が切れました。ローカル作業は継続中。」 */
  readonly reconnecting: boolean;
}

export function useTaskStream(
  client: AstraClient | null,
  taskId: string | null,
  /** 一覧が持っている行。stream が何も流さない（終わった仕事）ときの種。 */
  seed: Task | null = null,
): TaskStreamState {
  const [view, setView] = useState<WorkView>(() => (seed ? seedWorkView(seed) : emptyWorkView));
  const [reconnecting, setReconnecting] = useState(false);

  useEffect(() => {
    if (!client || !taskId) {
      setView(emptyWorkView);
      return;
    }
    const controller = new AbortController();
    setView(seed && seed.id === taskId ? seedWorkView(seed) : emptyWorkView);
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
    // seed は「まだ何も受け取っていない間だけ」効かせる（下の effect）。
    // ここに入れると 8 秒ごとの一覧更新で view が巻き戻り、受け取った step が消える。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, taskId]);

  // 一覧が後から届いたとき、まだ event を受け取っていなければ種を入れる
  useEffect(() => {
    if (!seed || seed.id !== taskId) return;
    setView((current) =>
      current.lastSequence === 0 && current.status === 'UNKNOWN' ? seedWorkView(seed) : current,
    );
  }, [seed, taskId]);

  return { view, reconnecting: reconnecting && !isTerminal(view.status) };
}
