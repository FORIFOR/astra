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
