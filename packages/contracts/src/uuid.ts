/**
 * UUIDv7 (RFC 9562)。実装仕様 §1.2 / 逸脱 D-05。
 *
 * 時系列ソート可能であることを利用して、カーソルページングの順序キーに使う。
 * ブラウザと Node の双方で動かすため Web Crypto のみを使い、`node:crypto` を import しない
 * （`@astra/contracts` は apps/desktop からも読み込まれる）。
 *
 *   unix_ts_ms : 48bit
 *   ver        :  4bit (= 7)
 *   rand_a     : 12bit  同一ミリ秒内の単調増加カウンタに充てる
 *   var        :  2bit (= 0b10)
 *   rand_b     : 62bit  乱数
 */

const HEX = Array.from({ length: 256 }, (_, i) => i.toString(16).padStart(2, '0'));

const MAX_COUNTER = 0x0fff;

function randomBytes(n: number): Uint8Array {
  const buf = new Uint8Array(n);
  globalThis.crypto.getRandomValues(buf);
  return buf;
}

export type Uuidv7Generator = (now?: number) => string;

/**
 * 単調増加の状態を持つ生成器を作る。
 *
 * 状態を生成器ごとに閉じ込めているのは、テストが決定的な論理時刻を与えられるようにするため。
 * 実行時は既定インスタンス `uuidv7` を使う。
 */
export function createUuidv7Generator(): Uuidv7Generator {
  let lastTimestamp = -1;
  let counter = 0;

  return function generate(now: number = Date.now()): string {
    let timestamp = now;

    if (timestamp > lastTimestamp) {
      counter = 0;
    } else {
      // 同一ミリ秒、または時計の巻き戻り。どちらも単調性を守る。
      timestamp = lastTimestamp;
      counter += 1;
      if (counter > MAX_COUNTER) {
        timestamp = lastTimestamp + 1;
        counter = 0;
      }
    }
    lastTimestamp = timestamp;

    const bytes = new Uint8Array(16);

    // unix_ts_ms (48bit, big endian)
    bytes[0] = Math.floor(timestamp / 2 ** 40) & 0xff;
    bytes[1] = Math.floor(timestamp / 2 ** 32) & 0xff;
    bytes[2] = Math.floor(timestamp / 2 ** 24) & 0xff;
    bytes[3] = Math.floor(timestamp / 2 ** 16) & 0xff;
    bytes[4] = Math.floor(timestamp / 2 ** 8) & 0xff;
    bytes[5] = timestamp & 0xff;

    // ver(4bit)=7 + rand_a(12bit)=counter
    bytes[6] = 0x70 | ((counter >>> 8) & 0x0f);
    bytes[7] = counter & 0xff;

    const rand = randomBytes(8);
    // var(2bit)=0b10 + rand_b 上位 6bit
    bytes[8] = 0x80 | (rand[0]! & 0x3f);
    for (let i = 1; i < 8; i += 1) bytes[8 + i] = rand[i]!;

    let out = '';
    for (let i = 0; i < 16; i += 1) {
      out += HEX[bytes[i]!];
      if (i === 3 || i === 5 || i === 7 || i === 9) out += '-';
    }
    return out;
  };
}

/**
 * 既定の生成器。プロセス内での生成順と辞書順が一致する。
 *
 * 注意: `now` を明示しても、既に発行済みの論理時刻より前には戻らない（単調性が優先される）。
 * 決定的な時刻が必要なテストは `createUuidv7Generator()` で独立した生成器を作ること。
 */
export const uuidv7: Uuidv7Generator = createUuidv7Generator();

/** UUID 文字列から生成時刻(ms)を取り出す。v7 以外は null。 */
export function uuidv7Timestamp(uuid: string): number | null {
  if (!isUuidV7(uuid)) return null;
  const hex = uuid.replace(/-/g, '').slice(0, 12);
  return Number.parseInt(hex, 16);
}

const UUID_V7_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isUuidV7(value: string): boolean {
  return UUID_V7_RE.test(value);
}
