/**
 * Video の step を task-service へ差し込む。正本 §15.2。
 *
 * **書き出せたふりをしない。**生成モデルは未決（OQ-19）なので、
 * `video.render` は繋がっていなければ繋がっていないと言って落ちる。
 * それらしい映像を残すと、あとから本物と見分けられなくなる。
 *
 * storyboard と字幕は、モデルが無くても意味のある成果物なので、
 * ちゃんと作って Library へ残す。
 */
import { AstraError } from '@astra/contracts';
import type { DomainService } from './domain.js';
import { renderProblems, storyboard, toClip, toWebVtt, totalDurationMs } from './video.js';

const VIDEO_PLUGIN = 'com.astra.video';

interface TaskLike {
  readonly taskId: string;
  readonly tenantId: string;
  readonly input: Record<string, unknown>;
}

interface StepLike {
  readonly toolId: string;
  readonly args: Record<string, unknown>;
}

export interface VideoExecutorResult {
  result: unknown;
  detail?: string | null;
  artifact?: { title: string; markdown: string };
}

type Executor = {
  execute(input: TaskLike, step: StepLike): Promise<VideoExecutorResult>;
};

/**
 * 映像を実際に作る先。**繋がっていなければ渡さない。**
 * 渡されていないことと、失敗したことを、呼ぶ側が区別できるようにしてある。
 */
export interface VideoRenderer {
  readonly name: string;
  render(input: {
    readonly tenantId: string;
    readonly projectId: string;
  }): Promise<{ artifactId: string }>;
}

function projectIdOf(input: TaskLike, step: StepLike): string {
  const fromStep = step.args['project_id'];
  if (typeof fromStep === 'string' && fromStep.length > 0) return fromStep;
  const fromTask = input.input['project_id'];
  if (typeof fromTask === 'string' && fromTask.length > 0) return fromTask;
  throw new AstraError('common.validation_failed', 'この作業には映像プロジェクトの指定が要ります');
}

export function videoExecutors(
  domain: DomainService,
  renderer?: VideoRenderer,
): Record<string, Executor> {
  const clipsOf = async (tenantId: string, projectId: string) =>
    (await domain.linked(tenantId, projectId, 'video_clip')).map(toClip);

  return {
    'video.storyboard': {
      async execute(input, step) {
        const projectId = projectIdOf(input, step);
        const clips = await clipsOf(input.tenantId, projectId);
        const frames = storyboard(clips);

        const lines = [
          '# 構成',
          '',
          `全 ${frames.length} コマ・${Math.round(totalDurationMs(clips) / 1000)} 秒`,
          '',
          ...frames.map(
            (frame) =>
              `${frame.order}. **${frame.name}**（${frame.source}・${Math.round(frame.durationMs / 1000)}秒）` +
              (frame.subtitle ? `\n   字幕: ${frame.subtitle}` : '') +
              (frame.voiceover ? `\n   読み: ${frame.voiceover}` : ''),
          ),
        ];

        return {
          result: { frames: frames.length, duration_ms: totalDurationMs(clips) },
          detail: `${frames.length} コマ`,
          artifact: { title: '構成', markdown: lines.join('\n') },
        };
      },
    },

    'video.subtitles': {
      async execute(input, step) {
        const projectId = projectIdOf(input, step);
        const clips = await clipsOf(input.tenantId, projectId);
        const vtt = toWebVtt(clips);
        const cues = vtt.split('-->').length - 1;

        return {
          result: { cues },
          detail: `${cues} 件`,
          // WebVTT はそのまま使える形で残す
          artifact: { title: '字幕', markdown: vtt },
        };
      },
    },

    'video.render': {
      async execute(input, step) {
        const projectId = projectIdOf(input, step);
        const clips = await clipsOf(input.tenantId, projectId);

        // 出せない理由を先に全部言う。1 つずつ突き返さない。
        const problems = renderProblems(clips);
        if (problems.length > 0) {
          throw new AstraError('common.validation_failed', problems.join(' / '));
        }

        if (!renderer) {
          /*
           * **ここで代役を作らない。**中身の無い映像が Library に残ると、
           * あとから本物と見分けられなくなる。繋がっていないと言って止まる。
           */
          throw new AstraError(
            'host.not_connected',
            '映像の生成にまだ繋がっていません（正本 §15.2・OQ-19）。構成と字幕はここまでで残っています。',
          );
        }

        const { artifactId } = await renderer.render({ tenantId: input.tenantId, projectId });
        return { result: { artifact_id: artifactId, renderer: renderer.name }, detail: null };
      },
    },
  };
}

export { VIDEO_PLUGIN };
