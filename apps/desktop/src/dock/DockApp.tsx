/**
 * Dock window のルート。main window が閉じていても Conversation Engine、
 * Local Agent Host、Voice Runtime へ直接つながる。
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MutableRefObject,
  type ReactElement,
} from 'react';
import { AstraClient } from '@astra/api-client';
import type { ApprovalId } from '@astra/contracts';
import { ThemeProvider } from '../state/ThemeProvider.js';
import { SessionProvider, useSession } from '../state/SessionProvider.js';
import { useTaskStream } from '../work/useTaskStream.js';
import { workspace } from '../host/tauri.js';
import { useVoiceRuntime } from '../voice/voiceRuntime.js';
import { voiceDemoFrom } from '../voice/demo.js';
import { approvalFailureMessage } from '../work/approvalOutcome.js';
import { dockMetrics } from '../host/tauri.js';
import { recordUxMetric } from '../ux/metrics.js';
import { TaskDock } from './TaskDock.js';
import type { ContextReferent, DockConversation } from './useDockMachine.js';
import './dock.css';

function useConversation(
  client: AstraClient | null,
  conversationId: MutableRefObject<string | null>,
  consumeVoiceTurn: () => boolean,
  onTaskStarted: (taskId: string) => void,
  onImmediateResult: (text: string) => void,
): DockConversation | undefined {
  const send = useCallback(
    async (text: string, referents: readonly ContextReferent[]) => {
      if (!client) throw new Error('まだ接続していません');
      const fromVoice = consumeVoiceTurn();
      if (!conversationId.current) {
        conversationId.current = (
          await client.startConversation({ response_mode: fromVoice ? 'voice' : 'text' })
        ).id;
      }
      const result = await client.sendTurn(conversationId.current, {
        text,
        modality: fromVoice ? 'voice' : 'text',
        interrupt: true,
        context_referents: referents.map((referent) => ({
          label: referent.label,
          kind: referent.kind,
        })),
      });

      // API が task id を返す。一覧を polling して別の仕事を拾わない。
      if (result.taskId) onTaskStarted(result.taskId);
      const immediate = result.answer ?? result.notice;
      if (immediate) onImmediateResult(immediate);
      return {
        needsClarification: result.needsClarification,
        answer: result.answer,
        taskId: result.taskId,
        notice: result.notice,
      };
    },
    [client, consumeVoiceTurn, conversationId, onImmediateResult, onTaskStarted],
  );

  return useMemo(() => (client ? { send } : undefined), [client, send]);
}

function textCanBeRead(mimeType: string): boolean {
  return (
    mimeType.startsWith('text/') ||
    mimeType === 'application/json' ||
    mimeType === 'application/markdown'
  );
}

function DockSurface(): ReactElement {
  // §23 Dock summon: Rust が測った値を受け取って記録する
  useEffect(() => {
    let off: (() => void) | null = null;
    void dockMetrics
      .onSummoned((ms) => recordUxMetric('dock_summon', ms))
      .then((o) => {
        off = o;
      });
    return () => off?.();
  }, []);
  const { client, status } = useSession();
  const live = status === 'signed-in' ? client : null;
  const conversationRef = useRef<string | null>(null);
  const [taskId, setTaskId] = useState<string | null>(null);
  const [resultText, setResultText] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const spokenArtifact = useRef<string | null>(null);
  const voiceRuntime = useVoiceRuntime(live);

  const handleTaskStarted = useCallback((id: string) => {
    setTaskId(id);
    setResultText(null);
  }, []);
  const handleImmediateResult = useCallback(
    (text: string) => {
      setResultText(text);
      void voiceRuntime.speakResult(text);
    },
    [voiceRuntime.speakResult],
  );
  const conversation = useConversation(
    live,
    conversationRef,
    voiceRuntime.consumeVoiceTurn,
    handleTaskStarted,
    handleImmediateResult,
  );
  const { view } = useTaskStream(live, taskId);
  const work = taskId && view.status !== 'UNKNOWN' ? view : null;

  useEffect(() => {
    const artifactId = view.resultArtifactId;
    if (!live || view.status !== 'COMPLETED' || !artifactId) return;
    if (spokenArtifact.current === artifactId) return;
    spokenArtifact.current = artifactId;
    let cancelled = false;

    void Promise.all([live.getArtifact(artifactId), live.artifactContent(artifactId)])
      .then(async ([artifact, content]) => {
        if (cancelled) return;
        const text = textCanBeRead(artifact.mime_type)
          ? await content.text()
          : `${artifact.title}が完成しました。`;
        if (cancelled) return;
        setResultText(text);
        await voiceRuntime.speakResult(text);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setResultText(
          error instanceof Error
            ? `結果を開けませんでした（${error.message}）`
            : '結果を開けませんでした。',
        );
        voiceRuntime.settle();
      });

    return () => {
      cancelled = true;
    };
  }, [live, view.resultArtifactId, view.status, voiceRuntime.settle, voiceRuntime.speakResult]);

  useEffect(() => {
    if (view.status === 'FAILED' || view.status === 'CANCELLED') voiceRuntime.settle();
  }, [view.status, voiceRuntime.settle]);

  return (
    <TaskDock
      // 常に居る入口。起動直後は上部のピル
      initialState="IDLE"
      {...(conversation ? { conversation } : {})}
      {...(voiceRuntime.dictation ? { dictation: voiceRuntime.dictation } : {})}
      voiceLevels={{ input: voiceRuntime.inputLevel, output: voiceRuntime.outputLevel }}
      voiceMode={voiceRuntime.mode}
      voiceUnavailable={voiceRuntime.unavailable}
      onRequestSubmitted={() => {
        setResultText(null);
        voiceRuntime.beginThinking();
      }}
      resultText={resultText}
      notice={notice}
      {...(work ? { work } : {})}
      {...(live && taskId
        ? {
            onApprove: (approvalId: string) =>
              void live
                .decideApproval(taskId, {
                  approval_id: approvalId as ApprovalId,
                  decision: 'APPROVED',
                })
                .then(() => setNotice(null))
                .catch((error: unknown) => setNotice(approvalFailureMessage(error))),
            onReject: (approvalId: string) =>
              void live
                .decideApproval(taskId, {
                  approval_id: approvalId as ApprovalId,
                  decision: 'REJECTED',
                })
                .then(() => setNotice(null))
                .catch((error: unknown) => setNotice(approvalFailureMessage(error))),
            onStop: () => void live.cancelTask(taskId),
            onOpenWorkspace: () => void workspace.open(taskId),
          }
        : {})}
    />
  );
}

/** 見た目の確認用（開発ビルドのみ）。`#/dock?demo=listening` などで姿を固定する。 */
function DemoDock(): ReactElement | null {
  const demo = voiceDemoFrom(globalThis.location?.hash ?? '', import.meta.env.DEV);
  if (!demo) return null;
  return (
    <ThemeProvider>
      <TaskDock
        initialState={demo.state}
        initialSurface={demo.surface}
        voiceMode={demo.mode}
        voiceLevels={demo.levels}
        resultText={demo.resultText}
      />
    </ThemeProvider>
  );
}

export function DockApp(): ReactElement {
  const demo = voiceDemoFrom(globalThis.location?.hash ?? '', import.meta.env.DEV);
  if (demo) return <DemoDock />;
  return (
    <ThemeProvider>
      <SessionProvider>
        <DockSurface />
      </SessionProvider>
    </ThemeProvider>
  );
}
