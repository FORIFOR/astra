/**
 * Video Agent。正本 §15.2。
 *
 * **ここで作る価値はモデルではなく、段取り**にある:
 *
 *   - 何をどの順で映すのか（storyboard / clips / timeline）
 *   - 何を喋るのか（voiceover）と、何と出るのか（subtitle）
 *   - いつ書き出したのか、いま何番目か（render jobs）
 *
 * text/image-to-video のモデルは未決（OQ-19）。
 * **代役で「それらしい動画」を作らない。**中身の無い映像が Library に
 * 残ると、あとから本物と見分けられなくなる。書き出しは、繋がっていなければ
 * 繋がっていないと言って止まる。段取りの側は、それでも全部動く。
 */
import type { DomainEntity, EntityDef } from '@astra/contracts';

/** 正本 §15.2 の entity。plugin が持ち込む形をそのまま書いてある。 */
export const VIDEO_ENTITIES: Record<string, EntityDef> = {
  video_project: {
    id: 'video_project',
    title: '映像プロジェクト',
    title_field: 'name',
    fields: [
      { id: 'name', type: 'text', required: true },
      { id: 'aspect', type: 'enum', values: ['16:9', '9:16', '1:1'], required: false },
      { id: 'note', type: 'text', required: false },
    ],
  },
  video_clip: {
    id: 'video_clip',
    title: 'クリップ',
    title_field: 'name',
    fields: [
      { id: 'name', type: 'text', required: true },
      { id: 'project', type: 'reference', entity: 'video_project', required: true },
      /** 並び。**飛び番を許す。**間に差し込むたびに全部振り直すのは無駄。 */
      { id: 'order', type: 'number', required: true },
      /** text-to-video の指示。image-to-video なら source と併用する。 */
      { id: 'prompt', type: 'text', required: false },
      /** image-to-video の元。Library の artifact を指す。 */
      { id: 'source_artifact', type: 'text', required: false },
      { id: 'duration_ms', type: 'number', required: false },
      { id: 'subtitle', type: 'text', required: false },
      { id: 'voiceover', type: 'text', required: false },
    ],
  },
  render_job: {
    id: 'render_job',
    title: '書き出し',
    title_field: 'name',
    fields: [
      { id: 'name', type: 'text', required: true },
      { id: 'project', type: 'reference', entity: 'video_project', required: true },
      {
        id: 'status',
        type: 'enum',
        values: ['QUEUED', 'RENDERING', 'DONE', 'FAILED'],
        required: true,
      },
      /** 書き出した結果。失敗なら空のまま。 */
      { id: 'artifact', type: 'text', required: false },
      /** 失敗した理由。**空にしない。** */
      { id: 'reason', type: 'text', required: false },
    ],
  },
};

export interface Clip {
  readonly id: string;
  readonly order: number;
  readonly name: string;
  readonly prompt: string | null;
  readonly sourceArtifactId: string | null;
  readonly durationMs: number | null;
  readonly subtitle: string | null;
  readonly voiceover: string | null;
}

/** 既定の尺。指示だけあって尺が無いクリップに使う。 */
export const DEFAULT_CLIP_MS = 4_000;

function text(entity: DomainEntity, field: string): string | null {
  const value = entity.fields[field];
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function num(entity: DomainEntity, field: string): number | null {
  const value = entity.fields[field];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function toClip(entity: DomainEntity): Clip {
  return {
    id: entity.id,
    order: num(entity, 'order') ?? 0,
    name: text(entity, 'name') ?? '無題のクリップ',
    prompt: text(entity, 'prompt'),
    sourceArtifactId: text(entity, 'source_artifact'),
    durationMs: num(entity, 'duration_ms'),
    subtitle: text(entity, 'subtitle'),
    voiceover: text(entity, 'voiceover'),
  };
}

/**
 * 並べる。**同じ order は、作った順で決める。**
 * 実行するたびに順番が変わると、書き出しが再現しない。
 */
export function timeline(clips: readonly Clip[]): Clip[] {
  return [...clips].sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
}

export interface TimelineEntry extends Clip {
  /** 先頭からの位置。 */
  readonly startMs: number;
  readonly endMs: number;
}

/** 位置を入れた timeline。字幕の時刻もここから決まる。 */
export function layout(clips: readonly Clip[]): TimelineEntry[] {
  let at = 0;
  return timeline(clips).map((clip) => {
    const duration = clip.durationMs ?? DEFAULT_CLIP_MS;
    const entry = { ...clip, startMs: at, endMs: at + duration };
    at += duration;
    return entry;
  });
}

export function totalDurationMs(clips: readonly Clip[]): number {
  return layout(clips).at(-1)?.endMs ?? 0;
}

/** 間に差し込むための order。**振り直さない。** */
export function orderBetween(before: number | null, after: number | null): number {
  if (before === null && after === null) return 1000;
  if (before === null) return after! - 1000;
  if (after === null) return before + 1000;
  return (before + after) / 2;
}

/**
 * 字幕。WebVTT。
 *
 * **字幕の無いクリップを、空の cue で埋めない。**
 * 空 cue は読み上げにも字幕表示にも出てしまう。
 */
export function toWebVtt(clips: readonly Clip[]): string {
  const cues = layout(clips)
    .filter((entry) => entry.subtitle !== null)
    .map((entry, index) => {
      return `${index + 1}\n${stamp(entry.startMs)} --> ${stamp(entry.endMs)}\n${entry.subtitle}`;
    });
  return ['WEBVTT', '', ...cues].join('\n\n').trimEnd() + '\n';
}

function stamp(ms: number): string {
  const total = Math.max(0, Math.floor(ms));
  const hours = Math.floor(total / 3_600_000);
  const minutes = Math.floor((total % 3_600_000) / 60_000);
  const seconds = Math.floor((total % 60_000) / 1000);
  const millis = total % 1000;
  const pad = (v: number, n = 2): string => String(v).padStart(n, '0');
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}.${pad(millis, 3)}`;
}

/**
 * 読み上げ原稿。voiceover のあるクリップだけを、順に。
 *
 * **無いところを埋めない。**「（無音）」のような行を足すと、
 * 読み上げにそのまま乗る。
 */
export function voiceoverScript(clips: readonly Clip[]): { at: number; text: string }[] {
  return layout(clips)
    .filter((entry) => entry.voiceover !== null)
    .map((entry) => ({ at: entry.startMs, text: entry.voiceover! }));
}

/** storyboard の 1 コマ。何を映して何を言うかを 1 行で見せる。 */
export interface StoryboardFrame {
  readonly order: number;
  readonly name: string;
  /** 何から作るか。**分からないものは「未指定」と言う。** */
  readonly source: string;
  readonly startMs: number;
  readonly durationMs: number;
  readonly subtitle: string | null;
  readonly voiceover: string | null;
}

export function storyboard(clips: readonly Clip[]): StoryboardFrame[] {
  return layout(clips).map((entry) => ({
    order: entry.order,
    name: entry.name,
    source:
      entry.sourceArtifactId !== null ? '画像から' : entry.prompt !== null ? '指示から' : '未指定',
    startMs: entry.startMs,
    durationMs: entry.endMs - entry.startMs,
    subtitle: entry.subtitle,
    voiceover: entry.voiceover,
  }));
}

/** 書き出せる状態か。**出せない理由を先に言う。** */
export function renderProblems(clips: readonly Clip[]): string[] {
  const problems: string[] = [];
  if (clips.length === 0) problems.push('クリップがありません');
  for (const clip of timeline(clips)) {
    if (clip.prompt === null && clip.sourceArtifactId === null) {
      // 何を映すか決まっていないものを、黙って飛ばさない
      problems.push(`「${clip.name}」に、何を映すかの指示も元の画像もありません`);
    }
    if (clip.durationMs !== null && clip.durationMs <= 0) {
      problems.push(`「${clip.name}」の尺が 0 以下です`);
    }
  }
  return problems;
}
