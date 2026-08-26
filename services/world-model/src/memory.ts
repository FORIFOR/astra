/**
 * 何を覚えて、何を覚えないか。正本 §10.3、Phase 6 実装仕様 §1.1。
 *
 * **全会話を"記憶"にしない。**「後で役に立つかもしれない」で溜めると、
 * 検索の精度が落ち、消す責任だけが残る。
 *
 * ここは純粋関数だけにしてある。何を残すかの判断は、
 * DB の都合ではなく方針そのものなので、単体で読めるようにしたい。
 */
import { MEMORABLE_KINDS, type FactKind, type FactSource } from '@astra/contracts';

export interface MemoryCandidate {
  readonly kind: string;
  readonly statement: string;
  readonly source: FactSource | null;
  /** 一時的な会話か。正本 §10.3「Temporary chat は short-term only」。 */
  readonly ephemeral?: boolean;
  readonly confidence?: number;
}

export type MemoryVerdict =
  | { readonly write: true; readonly kind: FactKind; readonly confidence: number }
  | { readonly write: false; readonly reason: string };

/** 信用に足りない抽出は書かない。曖昧な記憶は無いほうがまし。 */
export const MIN_CONFIDENCE = 0.5;

/** 覚えるには短すぎる。「はい」「了解」を commitment にしない。 */
export const MIN_STATEMENT_LENGTH = 4;

/**
 * 書いてよいかを決める。
 *
 * 落とす理由を返すのは、**黙って捨てないため**。
 * 「なぜ覚えていないのか」を後から説明できるようにしておく。
 */
export function shouldRemember(candidate: MemoryCandidate): MemoryVerdict {
  if (!(MEMORABLE_KINDS as readonly string[]).includes(candidate.kind)) {
    // 方針に無い種別は書かない（正本 §10.3）
    return { write: false, reason: `"${candidate.kind}" is not something we keep` };
  }
  if (candidate.ephemeral === true) {
    return { write: false, reason: 'temporary chat stays short-term' };
  }

  const statement = candidate.statement.trim();
  if (statement.length < MIN_STATEMENT_LENGTH) {
    return { write: false, reason: 'the statement is too short to be worth keeping' };
  }
  if (!candidate.source) {
    // 出所の無い記憶は作らない（D-43）
    return { write: false, reason: 'a fact needs a source we can point at' };
  }

  const confidence = candidate.confidence ?? 1;
  if (confidence < MIN_CONFIDENCE) {
    return { write: false, reason: `confidence ${confidence} is below ${MIN_CONFIDENCE}` };
  }

  return { write: true, kind: candidate.kind as FactKind, confidence };
}
