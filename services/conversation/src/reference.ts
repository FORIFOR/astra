/**
 * 指示語の解決。正本 §7.2「それ/あれ/2番/昨日の続き」、Phase 7 §2.2。
 *
 * **解決できないものを埋めない**（D-49）。
 * 埋めると、利用者が指したものとは別のものに対して動く。
 * 分からないなら分からないまま残し、聞き返す材料にする。
 */
import type { Referent, ReferenceResolution } from '@astra/contracts';

/** 直近のものを指す語。 */
const ANAPHORA = ['それ', 'あれ', 'これ', 'その', 'あの', 'この'];

/** 「2番」「3つ目」。1 始まりで数える（人が数える順）。 */
const ORDINAL = /(\d+)\s*(番目|番|つ目|個目)/;

/** 「昨日の続き」「さっきの」。時間で遡る。 */
const TEMPORAL = [
  { pattern: /昨日の(続き|やつ|件)/, days: 1 },
  { pattern: /さっきの/, days: 0 },
  { pattern: /先ほどの/, days: 0 },
];

export interface ResolutionContext {
  /** 0 が直近。 */
  readonly referents: readonly Referent[];
  /** 直近に提示した一覧。「2番」はここを指す。 */
  readonly lastList?: readonly Referent[];
}

/**
 * 入力から指示語を拾い、解決を試みる。
 *
 * 戻り値には**解決できなかったものも含める**。
 * 落とすと、呼び出し側は「指示語が無かった」と区別できなくなる。
 */
export function resolveReferences(text: string, context: ResolutionContext): ReferenceResolution[] {
  const out: ReferenceResolution[] = [];

  // 「2番」。一覧が無ければ解決できない。
  const ordinal = ORDINAL.exec(text);
  if (ordinal) {
    const nth = Number(ordinal[1]);
    const list = context.lastList ?? [];
    const picked = nth >= 1 && nth <= list.length ? list[nth - 1]! : null;
    out.push({
      phrase: ordinal[0],
      resolved: picked,
      reason: picked
        ? null
        : list.length === 0
          ? 'nothing was listed to count from'
          : `only ${list.length} item(s) were listed`,
    });
  }

  // 「それ」「あれ」。直近の referent。
  const anaphor = ANAPHORA.find((word) => text.includes(word));
  if (anaphor) {
    const nearest = context.referents[0] ?? null;
    out.push({
      phrase: anaphor,
      resolved: nearest,
      reason: nearest ? null : 'nothing has been referred to yet',
    });
  }

  // 「昨日の続き」。時間で遡る。
  for (const { pattern } of TEMPORAL) {
    const match = pattern.exec(text);
    if (!match) continue;
    // 時間で絞る材料はここには無い。**推測で直近を当てない。**
    out.push({
      phrase: match[0],
      resolved: null,
      reason: 'referring back in time needs the conversation history',
    });
  }

  return out;
}

/** すべて解決できたか。ひとつでも欠けたら false。 */
export function fullyResolved(resolutions: readonly ReferenceResolution[]): boolean {
  return resolutions.every((r) => r.resolved !== null);
}

/**
 * 聞き返す文面。正本 §7.2「no repeat questions when context exists」。
 *
 * **解決できたものは聞かない。**解決できなかったものだけを、
 * その語のまま尋ねる。「何について？」と丸ごと聞き直さない。
 */
export function clarificationFor(resolutions: readonly ReferenceResolution[]): string | null {
  const unresolved = resolutions.filter((r) => r.resolved === null);
  if (unresolved.length === 0) return null;
  const phrases = [...new Set(unresolved.map((r) => r.phrase))];
  return `「${phrases.join('」「')}」がどれを指すか分かりませんでした。`;
}

/** 触れたものを積む。0 が最新。同じものは前に出す。 */
export function remember(
  referents: readonly Referent[],
  next: Omit<Referent, 'index'>,
  limit = 20,
): Referent[] {
  const key = JSON.stringify(next.target);
  const rest = referents.filter((r) => JSON.stringify(r.target) !== key);
  return [{ ...next, index: 0 }, ...rest].slice(0, limit).map((r, index) => ({ ...r, index }));
}
