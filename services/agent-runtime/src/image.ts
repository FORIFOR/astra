/**
 * Image Agent。正本 §15.1、Phase 5 実装仕様 §5。
 *
 * 生成モデルは未決（OQ-19）なので、差し替え口と代役を置く。
 * **ここで作る価値はモデルではなく、生成物の扱い**にある:
 *
 *   - 何を頼んで出てきたのかが後から分かる（prompt の記録）
 *   - どれから派生したのかが辿れる（version lineage）
 *   - 黙って消えない（Library への自動保存）
 *
 * モデルが決まっても、この部分は書き直さない。
 */
import { AstraError, type Artifact } from '@astra/contracts';
import type { LibraryService } from '@astra/service-library';

export interface GenerateImageRequest {
  readonly prompt: string;
  /** 直前の生成から派生させる。variation / edit はこれを使う。 */
  readonly parentArtifactId?: string | null;
  readonly width?: number;
  readonly height?: number;
  /** 同じ種で同じ絵。再現できないと lineage の意味が薄い。 */
  readonly seed?: number;
}

export interface GeneratedImage {
  readonly bytes: Uint8Array;
  readonly mimeType: string;
  readonly width: number;
  readonly height: number;
  /** 実際に使われた種。指定しなければ provider が決める。 */
  readonly seed: number;
}

export interface ImageGenerator {
  generate(request: GenerateImageRequest): Promise<GeneratedImage>;
  readonly name: string;
  readonly isStandIn: boolean;
}

/** 生成物 1 枚の上限。無制限にすると Library が壊れる。 */
export const MAX_IMAGE_BYTES = 16 * 1024 * 1024;

/**
 * 決定的な代役。**絵は描けないので描いたふりをしない。**
 * 同じ prompt と seed から同じバイト列を返す、それだけのもの。
 * lineage と保存の経路を試すのに要るのはそこだけ。
 */
export class DeterministicImageGenerator implements ImageGenerator {
  readonly name = 'deterministic';
  readonly isStandIn = true;

  async generate(request: GenerateImageRequest): Promise<GeneratedImage> {
    const seed = request.seed ?? hash(request.prompt);

    // 1x1 の PNG を、prompt から決まる色で作る。
    // 本物の絵ではないことが見て分かるほうがよい。
    const bytes = onePixelPng(seed);

    /*
     * **頼まれた寸法を、作った寸法として返さない。**
     *
     * 返していた間、1x1 の PNG が「1024x1024」と名乗っていた。
     * 中身と食い違う寸法を台帳に残すと、あとから本物と見分けられなくなる。
     * 作ったのは 1 ピクセルなので、1 ピクセルと言う。
     */
    return { bytes, mimeType: 'image/png', width: 1, height: 1, seed };
  }
}

function hash(text: string): number {
  let h = 2_166_136_261;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16_777_619);
  }
  return h >>> 0;
}

/** 有効な PNG。中身は 1 ピクセル。 */
function onePixelPng(seed: number): Uint8Array {
  const rgb = [(seed >> 16) & 0xff, (seed >> 8) & 0xff, seed & 0xff];
  const idat = Buffer.from([0x00, ...rgb]);
  const chunks = [
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', Buffer.from([0, 0, 0, 1, 0, 0, 0, 1, 8, 2, 0, 0, 0])),
    pngChunk('IDAT', zlibStore(idat)),
    pngChunk('IEND', Buffer.alloc(0)),
  ];
  return Buffer.concat(chunks);
}

function pngChunk(type: string, body: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(body.length);
  const typed = Buffer.concat([Buffer.from(type, 'ascii'), body]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typed));
  return Buffer.concat([length, typed, crc]);
}

/** 無圧縮の zlib ストリーム。deflate を持ち込まないため。 */
function zlibStore(data: Buffer): Buffer {
  const header = Buffer.from([0x78, 0x01]);
  const block = Buffer.alloc(5);
  block[0] = 0x01;
  block.writeUInt16LE(data.length, 1);
  block.writeUInt16LE(~data.length & 0xffff, 3);
  const adler = Buffer.alloc(4);
  adler.writeUInt32BE(adler32(data));
  return Buffer.concat([header, block, data, adler]);
}

function adler32(data: Buffer): number {
  let a = 1;
  let b = 0;
  for (const byte of data) {
    a = (a + byte) % 65_521;
    b = (b + a) % 65_521;
  }
  return ((b << 16) | a) >>> 0;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb8_8320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(data: Buffer): number {
  let c = 0xffff_ffff;
  for (const byte of data) c = CRC_TABLE[(c ^ byte) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffff_ffff) >>> 0;
}

// ------------------------------------------------------------------ service

export interface ImageServiceDeps {
  readonly library: LibraryService;
  readonly generator: ImageGenerator;
}

export interface GenerateResult {
  readonly artifact: Artifact;
  readonly seed: number;
}

export class ImageService {
  readonly #library: LibraryService;
  readonly #generator: ImageGenerator;

  constructor(deps: ImageServiceDeps) {
    this.#library = deps.library;
    this.#generator = deps.generator;
  }

  /**
   * 生成して Library へ残す。
   *
   * **prompt を artifact に必ず載せる。**載せないと、
   * 後から見て「これは何を頼んだ絵なのか」が分からなくなる。
   */
  async generate(input: {
    readonly tenantId: string;
    readonly userId: string;
    readonly request: GenerateImageRequest;
    readonly taskId?: string | null;
  }): Promise<GenerateResult> {
    const prompt = input.request.prompt.trim();
    if (prompt.length === 0) {
      throw new AstraError('common.validation_failed', 'an image needs a prompt');
    }

    // 派生元がこのテナントのものであることを確かめてから作る。
    // 確かめずに parent を付けると、他人の作品に紐づけられる。
    if (input.request.parentArtifactId) {
      await this.#library.get(input.tenantId, input.request.parentArtifactId);
    }

    const image = await this.#generator.generate({ ...input.request, prompt });
    if (image.bytes.byteLength > MAX_IMAGE_BYTES) {
      throw new AstraError('artifact.too_large', 'the generated image is too large to store');
    }

    const artifact = await this.#library.create({
      tenantId: input.tenantId,
      ownerId: input.userId,
      type: 'IMAGE',
      title: titleFor(prompt),
      mimeType: image.mimeType,
      body: Buffer.from(image.bytes),
      fileName: `${titleFor(prompt)}.png`,
      sourceAgentId: 'image',
      sourceTaskId: input.taskId ?? null,
      parentArtifactId: input.request.parentArtifactId ?? null,
      // 何を頼んだかを残す。ここが lineage の一次情報。
      tags: [
        `prompt:${prompt}`,
        `seed:${image.seed}`,
        `generator:${this.#generator.name}`,
        /*
         * **代役で作ったものに、印を残す。**
         *
         * 生成器の名前だけでは、あとで名前を変えたときに読み解けない。
         * 印が付いていれば、Library を見る側が「これは絵ではない」と
         * 分かる。付けないと、中身の無い画像が本物に紛れる。
         */
        ...(this.#generator.isStandIn ? ['stand-in:true'] : []),
      ],
    });

    return { artifact, seed: image.seed };
  }

  /** artifact から prompt を読み戻す。UI の履歴表示に使う。 */
  static promptOf(artifact: Artifact): string | null {
    const tag = artifact.tags.find((t) => t.startsWith('prompt:'));
    return tag ? tag.slice('prompt:'.length) : null;
  }

  static seedOf(artifact: Artifact): number | null {
    const tag = artifact.tags.find((t) => t.startsWith('seed:'));
    if (!tag) return null;
    const value = Number(tag.slice('seed:'.length));
    return Number.isFinite(value) ? value : null;
  }
}

/** 一覧で読める長さに切る。prompt そのものは tag に残る。 */
export function titleFor(prompt: string): string {
  const trimmed = prompt.replace(/\s+/g, ' ').trim();
  return trimmed.length <= 40 ? trimmed : `${trimmed.slice(0, 39)}…`;
}
