/**
 * finalize の各段を task-service へ差し込む。Phase 3 実装仕様 §5、D-28。
 *
 * task 側は「何をどの順でやるか」だけを持ち、中身は知らない（`StepExecutor`）。
 * ここが meeting 側の入口。
 */
import { AUDIO_SAMPLE_RATE_HZ, MeetingBundle, type MeetingSegment } from '@astra/contracts';
import type { LibraryService } from '@astra/service-library';
import type { MeetingService } from './service.js';
import type { BatchTranscriber } from './providers.js';
import type { RecordingStore } from './recording.js';
import { durationMs, speakerCount, withCitations, type MeetingSummarizer } from './summarize.js';

interface TaskLike {
  readonly taskId: string;
  readonly tenantId: string;
  readonly userId: string;
  readonly input: Record<string, unknown>;
}

interface StepLike {
  readonly toolId: string;
  readonly args: Record<string, unknown>;
}

export interface MeetingExecutorResult {
  result: unknown;
  detail?: string | null;
  artifact?: { title: string; markdown: string };
}

export interface MeetingExecutorDeps {
  readonly meetings: MeetingService;
  readonly library: LibraryService;
  readonly recordings: RecordingStore;
  readonly batch: BatchTranscriber;
  readonly summarizer: MeetingSummarizer;
}

function meetingIdOf(input: TaskLike, step: StepLike): string {
  const fromStep = step.args['meeting_id'];
  if (typeof fromStep === 'string' && fromStep.length > 0) return fromStep;
  const fromTask = input.input['meeting_id'];
  if (typeof fromTask === 'string' && fromTask.length > 0) return fromTask;
  throw new Error('meeting.finalize needs a meeting_id');
}

export function meetingExecutors(deps: MeetingExecutorDeps): Record<
  string,
  {
    execute(input: TaskLike, step: StepLike): Promise<MeetingExecutorResult>;
    onFailure(input: TaskLike, step: StepLike): Promise<void>;
  }
> {
  const { meetings, library, recordings, batch, summarizer } = deps;

  /**
   * finalize が落ちたら会議を FAILED にする。
   *
   * **FINALIZING のまま残さない。**UI/UX §12.5 は「閉じても続く」と
   * 言っているので、進行中のまま止まると利用者は待ち続けることになる。
   * 録音そのものは Library に残っているので、失われるものはない。
   */
  const onFailure = async (input: TaskLike, step: StepLike): Promise<void> => {
    await meetings.setStatus(input.tenantId, meetingIdOf(input, step), 'FAILED');
  };

  return {
    /** 録音を閉じ、Library へ入れる。**まずこれ**。以降が失敗しても音は残る。 */
    'meeting.seal': {
      onFailure,
      async execute(input, step) {
        const meetingId = meetingIdOf(input, step);
        const meeting = await meetings.get(input.tenantId, meetingId);
        if (meeting.recording_artifact_id) {
          // activity の再実行。作り直さない。
          return { result: { artifact_id: meeting.recording_artifact_id }, detail: null };
        }

        const audio = await recordings.seal(meetingId);
        const artifact = await library.create({
          tenantId: input.tenantId,
          ownerId: input.userId,
          type: 'AUDIO',
          title: `${meeting.title} 録音`,
          mimeType: 'audio/L16',
          body: Buffer.from(audio),
          // **sourceTaskId は付けない。**録音は finalize タスクの成果物ではなく
          // 会議のもの。付けると composeArtifact が議事録と取り違える。
          sourceMeetingId: meetingId,
        });
        await meetings.recordBundle(input.tenantId, meetingId, {
          recordingArtifactId: artifact.id,
        });

        const seconds = Math.round(audio.byteLength / 2 / AUDIO_SAMPLE_RATE_HZ);
        return { result: { artifact_id: artifact.id }, detail: `${seconds}s recorded` };
      },
    },

    /** 録音全体を精度優先で起こす（正本 §11.2 Final Accuracy Path）。 */
    'meeting.transcribe': {
      onFailure,
      async execute(input, step) {
        const meetingId = meetingIdOf(input, step);
        const meeting = await meetings.get(input.tenantId, meetingId);
        const existing = await meetings.segments(input.tenantId, meetingId, 'final');
        if (existing.length > 0) {
          return { result: { segments: existing.length }, detail: `${existing.length} segments` };
        }

        const audio = await recordings.seal(meetingId);
        const results = await batch.transcribe(audio, { language: meeting.language });
        return { result: { results: results.length }, detail: `${results.length} segments` };
      },
    },

    /**
     * live と突き合わせて final を積む。**live は書き換えない**（D-25）。
     * transcribe と分けてあるのは、突き合わせだけをやり直せるようにするため。
     */
    'meeting.reconcile': {
      onFailure,
      async execute(input, step) {
        const meetingId = meetingIdOf(input, step);
        const meeting = await meetings.get(input.tenantId, meetingId);
        const audio = await recordings.seal(meetingId);
        const results = await batch.transcribe(audio, { language: meeting.language });
        const saved = await meetings.applyFinalPass(input.tenantId, meetingId, results);

        const final = await meetings.segments(input.tenantId, meetingId, 'final');
        return {
          result: { added: saved.length, total: final.length },
          detail: `${speakerCount(final)} speakers`,
        };
      },
    },

    /** 要点・決定・ToDo。**引用の付かない項目は残さない**（AC3-9）。 */
    'meeting.summarize': {
      onFailure,
      async execute(input, step) {
        const meetingId = meetingIdOf(input, step);
        const segments = await meetings.segments(input.tenantId, meetingId);
        const draft = await summarizer.summarize(segments);
        const cited = withCitations(draft, segments);

        return {
          result: {
            summary: cited.summary,
            decisions: cited.decisions,
            action_items: cited.actionItems,
            open_questions: cited.openQuestions,
            dropped: cited.dropped,
          },
          detail: `${cited.decisions.length} decisions · ${cited.actionItems.length} todos`,
        };
      },
    },

    /** Meeting bundle を Library へ。UI/UX §12.6 の画面はこれを読む。 */
    'meeting.bundle': {
      onFailure,
      async execute(input, step) {
        const meetingId = meetingIdOf(input, step);
        const meeting = await meetings.get(input.tenantId, meetingId);
        const segments = await meetings.segments(input.tenantId, meetingId);
        const draft = await summarizer.summarize(segments);
        const cited = withCitations(draft, segments);

        const bundle = MeetingBundle.parse({
          meeting_id: meetingId,
          title: meeting.title,
          duration_ms: durationMs(segments),
          speaker_count: speakerCount(segments),
          summary: cited.summary,
          decisions: cited.decisions,
          action_items: cited.actionItems,
          open_questions: cited.openQuestions,
        });

        const speakers = await meetings.speakers(input.tenantId, meetingId);
        const markdown = renderBundle(bundle, segments, speakers);

        return {
          result: bundle,
          detail: `${segments.length} segments`,
          artifact: { title: meeting.title, markdown },
        };
      },
    },
  };
}

/**
 * 議事録の本文。**結論が先、transcript は後ろ**（UI/UX §12.6）。
 * 引用は `[n]` で、末尾の transcript の行番号に対応させる。
 */
export function renderBundle(
  bundle: MeetingBundle,
  segments: readonly MeetingSegment[],
  speakers: readonly { speaker_tag: number; display_name: string }[],
): string {
  const nameOf = new Map(speakers.map((s) => [s.speaker_tag, s.display_name]));
  const indexOf = new Map(segments.map((s, i) => [String(s.id), i + 1]));
  const cite = (claim: { citations: readonly { segment_id: string }[] }) =>
    claim.citations
      .map((c) => indexOf.get(String(c.segment_id)))
      .filter((n): n is number => n !== undefined)
      .map((n) => `[${n}]`)
      .join('');

  const section = (
    title: string,
    items: readonly { text: string; citations: readonly { segment_id: string }[] }[],
  ) =>
    items.length === 0
      ? ''
      : `## ${title}\n\n${items.map((i) => `- ${i.text} ${cite(i)}`.trim()).join('\n')}\n\n`;

  const mmss = (ms: number) => {
    const total = Math.floor(ms / 1000);
    return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
  };

  const transcript = segments
    .map((s, i) => {
      const who =
        s.speaker_tag === null ? '不明' : (nameOf.get(s.speaker_tag) ?? `Speaker ${s.speaker_tag}`);
      return `${i + 1}. \`${mmss(s.start_ms)}\` **${who}** ${s.text}`;
    })
    .join('\n');

  return [
    `# ${bundle.title}`,
    '',
    `${mmss(bundle.duration_ms)} · ${bundle.speaker_count} participants`,
    '',
    section('要点', bundle.summary),
    section('決定事項', bundle.decisions),
    bundle.action_items.length === 0
      ? ''
      : `## ToDo\n\n${bundle.action_items
          .map((a) => `- ${a.assignee ? `**${a.assignee}** ` : ''}${a.text} ${cite(a)}`.trim())
          .join('\n')}\n\n`,
    section('未解決', bundle.open_questions),
    '## Transcript',
    '',
    transcript,
    '',
  ]
    .filter((part) => part !== '')
    .join('\n');
}
