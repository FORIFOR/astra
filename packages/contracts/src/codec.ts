/**
 * snake_case ⇄ camelCase 変換。実装仕様 §1.1 / 逸脱 D-08。
 *
 * ワイヤ表現は snake_case で統一し、TypeScript 側は camelCase で扱う。
 * 変換は**ここだけ**で行い、他所に散らさない。
 *
 * 重要 — 不透明領域を壊さないこと:
 *   `task.input` / `event.payload` / `approval.details` などはユーザー由来の
 *   任意 JSON であり、キーを変換すると値が壊れる。これらのキー配下は原文のまま複製する。
 *   不透明キーの集合は契約の一部であり、勝手に増減させない。
 */

/** 配下を変換しないキー。契約の一部。 */
export const OPAQUE_KEYS: readonly string[] = [
  'input', // Task.input（ユーザー由来）
  'payload', // EventEnvelope.payload（型ごとの union で別途検証する）
  'details', // Approval.details
  'args', // host.call の引数
  'value', // host.result の戻り値
  'metadata',
  'manifest', // 正規化済み manifest（署名対象なので一字も変えない）
  'edits', // 承認時の編集値
];

export interface CodecOptions {
  /** 追加の不透明キー。既定の OPAQUE_KEYS に追加される。 */
  readonly opaqueKeys?: readonly string[];
}

const snakeToCamel = (s: string): string =>
  s.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase());

const camelToSnake = (s: string): string => s.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();

function convert(
  value: unknown,
  rename: (k: string) => string,
  opaque: ReadonlySet<string>,
): unknown {
  if (Array.isArray(value)) return value.map((v) => convert(v, rename, opaque));
  if (value === null || typeof value !== 'object') return value;
  if (value instanceof Date) return value;

  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    const key = rename(k);
    out[key] = opaque.has(k) ? structuredClone(v) : convert(v, rename, opaque);
  }
  return out;
}

const opaqueSet = (opts?: CodecOptions): ReadonlySet<string> =>
  new Set([...OPAQUE_KEYS, ...(opts?.opaqueKeys ?? [])]);

/** ワイヤ (snake_case) → アプリ (camelCase) */
export function toCamel<T = unknown>(value: unknown, opts?: CodecOptions): T {
  return convert(value, snakeToCamel, opaqueSet(opts)) as T;
}

/** アプリ (camelCase) → ワイヤ (snake_case) */
export function toSnake<T = unknown>(value: unknown, opts?: CodecOptions): T {
  return convert(value, camelToSnake, opaqueSet(opts)) as T;
}
