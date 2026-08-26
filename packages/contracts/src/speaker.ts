/**
 * 誰が話したか。正本 §11.3・§12.2。
 *
 * **出所（provenance）が一次情報。**話者分離は二次。
 *
 *   source = microphone  → 自分
 *   source = system      → 相手側
 *   diarization          → その中の話者の区別
 *   参加者情報と対応が取れた → 名前
 *
 * この順にしか強くならない。**推測で名前を付けない。**
 * 「Speaker 1 と推測」「山田さんと推測」は、記録として使えなくなる。
 */
import { z } from 'zod';

/** どこまで分かっているか。**上へ行くほど確か。** */
export const ATTRIBUTION_LEVELS = ['unknown', 'side', 'separated', 'named'] as const;
export const AttributionLevel = z.enum(ATTRIBUTION_LEVELS);
export type AttributionLevel = z.infer<typeof AttributionLevel>;

/** 自分か相手か。混ざったものは判定に使えない。 */
export const SPEAKER_SIDES = ['self', 'other'] as const;
export const SpeakerSide = z.enum(SPEAKER_SIDES);
export type SpeakerSide = z.infer<typeof SpeakerSide>;

export const SpeakerAttribution = z.object({
  level: AttributionLevel,
  /** 出所から分かる側。混合音源では null。 */
  side: SpeakerSide.nullable().default(null),
  /** 分離で付いた番号。分離が無ければ null。 */
  speakerTag: z.number().int().positive().nullable().default(null),
  /** 対応が取れた名前。**取れていないなら null**（推測しない）。 */
  name: z.string().nullable().default(null),
});
export type SpeakerAttribution = z.infer<typeof SpeakerAttribution>;

/**
 * 出所から側を決める。
 *
 * **混ぜたものからは決まらない。**混合音源で「自分」と言うと、
 * 相手の発言が自分のものとして残る。
 */
export function sideFromSource(source: string): SpeakerSide | null {
  if (source === 'microphone') return 'self';
  if (source === 'system') return 'other';
  return null;
}

/**
 * 分かっているものを積む。**下の段が無いのに上を名乗らない。**
 */
export function attribute(input: {
  readonly source?: string | undefined;
  readonly speakerTag?: number | null | undefined;
  readonly name?: string | null | undefined;
}): SpeakerAttribution {
  const side = input.source === undefined ? null : sideFromSource(input.source);
  const speakerTag = input.speakerTag ?? null;
  const name = input.name ?? null;

  // 名前は、対応が取れたときだけ。取れていないなら下の段で止める。
  const level: AttributionLevel =
    name !== null
      ? 'named'
      : speakerTag !== null
        ? 'separated'
        : side !== null
          ? 'side'
          : 'unknown';

  return { level, side, speakerTag, name };
}

const SIDE_LABEL: Readonly<Record<SpeakerSide, string>> = {
  self: '自分',
  other: '相手',
};

/**
 * 画面に出す呼び名。
 *
 * **分からないものを「Speaker 1」と書かない。**
 * 番号は分離が付けたときだけ。何も分からないなら、分からないと書く。
 */
export function speakerLabel(attribution: SpeakerAttribution): string {
  if (attribution.name !== null) return attribution.name;
  if (attribution.speakerTag !== null) {
    const side = attribution.side === null ? '' : `${SIDE_LABEL[attribution.side]}・`;
    return `${side}Speaker ${attribution.speakerTag}`;
  }
  if (attribution.side !== null) return SIDE_LABEL[attribution.side];
  return '話者不明';
}

/** その段が根拠として使えるか。監査と議事録の引用で見る。 */
export function isAttributed(attribution: SpeakerAttribution): boolean {
  return attribution.level !== 'unknown';
}
