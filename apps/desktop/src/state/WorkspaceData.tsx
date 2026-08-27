/**
 * ワークスペースの表示データ。UI-3。
 *
 * Home / Work / Library が同じ一覧を見る。各画面が独立に取りに行くと、
 * タブを切り替えるたびに内容がずれる。
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactElement, ReactNode } from 'react';
import type { AstraClient, TaskView } from '@astra/api-client';
import type { Artifact, DailyBrief } from '@astra/contracts';

interface WorkspaceDataValue {
  readonly tasks: readonly TaskView[];
  readonly artifacts: readonly Artifact[];
  /** server が組んだ「今日気にすべきこと」。取れなければ null。 */
  readonly brief: DailyBrief | null;
  readonly loading: boolean;
  /** 取得できなかった理由。UI/UX §21: 影響と次の行動を伝えるため。 */
  readonly error: string | null;
  reload(): Promise<void>;
}

const WorkspaceDataContext = createContext<WorkspaceDataValue | null>(null);

export function WorkspaceDataProvider({
  client,
  children,
}: {
  client: AstraClient;
  children: ReactNode;
}): ReactElement {
  const [tasks, setTasks] = useState<readonly TaskView[]>([]);
  const [artifacts, setArtifacts] = useState<readonly Artifact[]>([]);
  const [brief, setBrief] = useState<DailyBrief | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async (): Promise<void> => {
    setLoading(true);
    try {
      // 片方だけ落ちても、取れた方は見せる。全部か無かにしない。
      const [taskPage, artifactPage, dailyBrief] = await Promise.allSettled([
        client.listTasks({ limit: 50 }),
        client.listArtifacts({ limit: 50 }),
        client.brief(),
      ]);
      if (taskPage.status === 'fulfilled') setTasks(taskPage.value.items);
      if (artifactPage.status === 'fulfilled') setArtifacts(artifactPage.value.items);
      // brief が取れなければ null のまま。Home は task だけで組み直す。
      setBrief(dailyBrief.status === 'fulfilled' ? dailyBrief.value : null);

      const failed = [taskPage, artifactPage].filter((r) => r.status === 'rejected');
      setError(failed.length > 0 ? '一部の情報を取得できませんでした。' : null);
    } finally {
      setLoading(false);
    }
  }, [client]);

  useEffect(() => {
    void reload();
    /*
     * 一度読んで終わりだった。仕事が始まって終わっても Home は古いまま —
     * 「名前のない仕事 進行中」が、とうに終わった仕事のまま残っていた。
     * 見えている間だけ、静かに読み直す。
     */
    const every = setInterval(() => {
      if (document.visibilityState === 'visible') void reload();
    }, 8_000);
    const onFocus = (): void => void reload();
    window.addEventListener('focus', onFocus);
    return () => {
      clearInterval(every);
      window.removeEventListener('focus', onFocus);
    };
  }, [reload]);

  const value = useMemo<WorkspaceDataValue>(
    () => ({ tasks, artifacts, brief, loading, error, reload }),
    [tasks, artifacts, brief, loading, error, reload],
  );

  return <WorkspaceDataContext.Provider value={value}>{children}</WorkspaceDataContext.Provider>;
}

export function useWorkspaceData(): WorkspaceDataValue {
  const value = useContext(WorkspaceDataContext);
  if (!value) throw new Error('useWorkspaceData must be used inside <WorkspaceDataProvider>');
  return value;
}

/**
 * 無くても動く読み方。
 *
 * shell（sidebar / top bar）は**データが無くても成り立つ面**なので、
 * ここで投げると、データを持たない画面まで落ちる。
 * 「まだ無い」と「壊れている」を分けるための入口。
 */
export function useOptionalWorkspaceData(): WorkspaceDataValue | null {
  return useContext(WorkspaceDataContext);
}
