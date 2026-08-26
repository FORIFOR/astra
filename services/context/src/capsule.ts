/**
 * Context Capsule の組み立て。正本 §6、Phase 7 実装仕様 §1。
 *
 * この service の役目はひとつだけ:
 *
 *   **raw なローカルデータを、そのまま外へ出さない。**
 *
 * 出るのは Capsule だけで、生データは
 * `allowed_raw_attachments` に明示されたものに限る。
 * ここを緩めると、画面に映っていたもの・選択していたものが
 * 利用者の知らないうちにクラウドへ渡る。
 */
import {
  ContextCapsule,
  mayLeaveDevice,
  type ContextSource,
  type Sensitivity,
} from '@astra/contracts';

/** 正本 §6.2 の local context。**このまま外へは出さない。** */
export interface LocalSignals {
  readonly activeApp?: string | null;
  readonly windowTitle?: string | null;
  readonly selectedText?: string | null;
  readonly currentUrl?: string | null;
  readonly recentFiles?: readonly string[];
  /** opt-in。既定では読まない。 */
  readonly clipboard?: string | null;
}

export interface CapsuleInput {
  readonly intent: string;
  readonly local?: LocalSignals;
  readonly sources?: readonly ContextSource[];
  readonly referents?: readonly string[];
  /**
   * 利用者が明示的に添付したものだけ。
   * **推測で足さない。**「役に立ちそう」で入れると、
   * 添付した覚えのないものが出ていく。
   */
  readonly attachments?: readonly string[];
  /** 選択テキストを添付として送ってよいと利用者が示したか。 */
  readonly selectionShared?: boolean;
}

/** 機密度の強さ。**上へ寄せる**ために順序を持たせる。 */
const RANK: Record<Sensitivity, number> = {
  PUBLIC: 0,
  PRIVATE: 1,
  CONFIDENTIAL: 2,
  REGULATED: 3,
};

/**
 * 束の機密度は、含まれるものの**最も高いもの**。
 *
 * 低いほうに寄せると、REGULATED を含む束が PRIVATE として出ていく。
 */
export function highestSensitivity(
  sources: readonly ContextSource[],
  floor: Sensitivity = 'PRIVATE',
): Sensitivity {
  return sources.reduce<Sensitivity>(
    (worst, s) => (RANK[s.sensitivity] > RANK[worst] ? s.sensitivity : worst),
    floor,
  );
}

/** ウィンドウ題名から、機微になりやすい部分を落とす。 */
function summarizeTitle(title: string | null | undefined): string | null {
  if (!title) return null;
  // 「ファイル名 — アプリ名」の形が多い。中身までは持ち出さない。
  const trimmed = title.split(/[—–|]/)[0]?.trim() ?? title.trim();
  return trimmed.length > 120 ? `${trimmed.slice(0, 119)}…` : trimmed;
}

/**
 * Capsule を組み立てる。
 *
 * `selected_text` は **`selectionShared` が真のときだけ**載る。
 * 既定で載せると、選択しただけで中身が出ていく。
 */
export function buildCapsule(input: CapsuleInput): ContextCapsule {
  const sources = [...(input.sources ?? [])];
  const sensitivity = highestSensitivity(sources);

  return ContextCapsule.parse({
    active_app: input.local?.activeApp ?? null,
    window_title: summarizeTitle(input.local?.windowTitle),
    user_intent: input.intent,
    referents: [...(input.referents ?? [])].slice(0, 20),
    // 選択テキストは、共有すると示されたときだけ
    selected_text: input.selectionShared ? (input.local?.selectedText ?? null) : null,
    sources,
    // 明示された添付だけ。推測で足さない。
    allowed_raw_attachments: [...(input.attachments ?? [])].slice(0, 20),
    sensitivity,
  });
}

export interface EgressDecision {
  readonly allowed: boolean;
  readonly reason: string | null;
  /** 送ってよい形。拒否のときは null。 */
  readonly capsule: ContextCapsule | null;
}

/**
 * この Capsule を外へ出してよいか。正本 §6.3 の data classification。
 *
 * REGULATED は plugin policy が決める建て付けだが、**その規則は
 * まだ実行していない**（OQ-25）。判定できないまま出すのは、
 * 判定して許すのとは違う。既定は出さない。
 */
export function decideEgress(
  capsule: ContextCapsule,
  options: { readonly regulatedAllowed?: boolean } = {},
): EgressDecision {
  if (!mayLeaveDevice(capsule.sensitivity, options.regulatedAllowed ?? false)) {
    return {
      allowed: false,
      reason: 'the context contains REGULATED data and no policy has been evaluated for it',
      capsule: null,
    };
  }
  return { allowed: true, reason: null, capsule };
}

/**
 * ローカルの生信号を、そのまま渡していないか確かめる。
 *
 * 検査そのものを関数にしてあるのは、**呼び出し側でうっかり
 * `local` を送れてしまう形にしない**ため。
 */
export function containsRawLocalData(
  capsule: ContextCapsule,
  local: LocalSignals | undefined,
): boolean {
  if (!local) return false;
  const carried = [capsule.selected_text, ...capsule.allowed_raw_attachments].filter(
    (v): v is string => typeof v === 'string' && v.length > 0,
  );
  // clipboard と URL は Capsule の口を持たない。載っていたら組み立てが壊れている。
  for (const raw of [local.clipboard, local.currentUrl]) {
    if (raw && carried.includes(raw)) return true;
  }
  return false;
}
