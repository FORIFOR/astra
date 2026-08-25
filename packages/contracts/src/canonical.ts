/**
 * 正規化 JSON と sha256。実装仕様 §9.2（manifest 署名）/ §13.2（監査ハッシュ連鎖）。
 *
 * 「同じ内容なら必ず同じバイト列」を保証する。ここがブレると
 * 署名検証もハッシュ連鎖も再現できなくなるため、規則を固定して他所で再実装しない。
 *
 * 規則:
 *   - オブジェクトのキーは UTF-16 コード単位の昇順（`Array.prototype.sort` の既定）
 *   - 空白なし
 *   - `undefined` のプロパティは出力しない（JSON.stringify と同じ）
 *   - 配列の順序は保持する
 *   - 数値は JSON.stringify の表現に従う。NaN / Infinity は拒否する
 *   - 循環参照は拒否する
 */

export type JsonSerializable =
  | null
  | boolean
  | number
  | string
  | readonly JsonSerializable[]
  | { readonly [key: string]: JsonSerializable | undefined };

export function canonicalJson(value: unknown): string {
  return write(value, new Set());
}

function write(value: unknown, seen: Set<object>): string {
  if (value === null) return 'null';

  switch (typeof value) {
    case 'boolean':
      return value ? 'true' : 'false';
    case 'number':
      if (!Number.isFinite(value)) {
        throw new TypeError(`canonicalJson: non-finite number (${String(value)})`);
      }
      return JSON.stringify(value);
    case 'string':
      return JSON.stringify(value);
    case 'bigint':
      throw new TypeError('canonicalJson: bigint is not representable in JSON');
    case 'undefined':
    case 'function':
    case 'symbol':
      throw new TypeError(`canonicalJson: ${typeof value} is not serializable`);
  }

  const obj = value as object;
  if (seen.has(obj)) throw new TypeError('canonicalJson: circular reference');
  seen.add(obj);
  try {
    if (Array.isArray(obj)) {
      // 配列要素の undefined は JSON.stringify に合わせて null にする
      return `[${obj.map((v) => (v === undefined ? 'null' : write(v, seen))).join(',')}]`;
    }
    if (obj instanceof Date) return JSON.stringify(obj.toISOString());

    const entries = Object.entries(obj as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${write(v, seen)}`).join(',')}}`;
  } finally {
    seen.delete(obj);
  }
}

const HEX = Array.from({ length: 256 }, (_, i) => i.toString(16).padStart(2, '0'));

export function toHex(bytes: Uint8Array): string {
  let out = '';
  for (const b of bytes) out += HEX[b];
  return out;
}

/**
 * sha256 を小文字 16 進で返す。
 * Web Crypto を使うため非同期。`node:crypto` は import しない（ブラウザでも動かすため）。
 */
export async function sha256Hex(input: string | Uint8Array): Promise<string> {
  const bytes = typeof input === 'string' ? new TextEncoder().encode(input) : input;
  const digest = await globalThis.crypto.subtle.digest(
    'SHA-256',
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
  );
  return toHex(new Uint8Array(digest));
}

/** 正規化してから sha256 を取る。署名・ハッシュ連鎖の入口。 */
export function canonicalSha256(value: unknown): Promise<string> {
  return sha256Hex(canonicalJson(value));
}
