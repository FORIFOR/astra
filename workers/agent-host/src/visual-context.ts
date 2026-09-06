/**
 * 端末内の画像の受け渡し場所。スクショ自動コンテキスト（SCREENSHOT_CONTEXT_GATE）。
 *
 * 利用者が「これ何？」と尋ねた turn に添えたスクショは、Astra.app が
 * `visual-context/<id>.png` へ写す。cloud を通るのは id とラベルだけで、
 * **画素はこのフォルダから、端末で走るモデル呼び出しが読む。**
 *
 * 置き場所は Astra.app（`LocalStore.dataRoot`）と同じ規約:
 *   `$ASTRA_DATA_ROOT` があればその下、無ければ `~/Library/Application Support/Astra`。
 * ここが食い違うと、画像は在るのに「見つからない」になる。
 */
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

/** cloud から来る 1 枚ぶん。形が違えば捨てる（id はファイル名になる）。 */
export interface ImageRef {
  readonly id: string;
  readonly kind: 'screenshot' | 'clipboard_image';
  readonly label: string;
}

const ID = /^[A-Za-z0-9-]{1,64}$/;

export function visualContextDir(env: NodeJS.ProcessEnv = process.env): string {
  const root =
    env['ASTRA_DATA_ROOT'] && env['ASTRA_DATA_ROOT'].length > 0
      ? env['ASTRA_DATA_ROOT']
      : join(homedir(), 'Library', 'Application Support', 'Astra');
  return join(root, 'visual-context');
}

/** args.images を読む。形が違うものは黙って落とす（id をパスに混ぜない）。 */
export function imageRefsOf(value: unknown): ImageRef[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item): ImageRef[] => {
    const row = item as Record<string, unknown> | null;
    const id = row?.['id'];
    const kind = row?.['kind'];
    const label = row?.['label'];
    if (typeof id !== 'string' || !ID.test(id)) return [];
    if (kind !== 'screenshot' && kind !== 'clipboard_image') return [];
    return [{ id, kind, label: typeof label === 'string' && label.length > 0 ? label : id }];
  });
}

export interface LocatedImage extends ImageRef {
  readonly path: string;
  /** 端末に実体があるか。無ければモデルに「見た」と言わせない。 */
  readonly present: boolean;
}

/** id → 端末内のパス。存在しないものは present=false のまま返す（落とさない: 無いことを伝える）。 */
export function locateImages(
  refs: readonly ImageRef[],
  dir: string = visualContextDir(),
  exists: (path: string) => boolean = existsSync,
): LocatedImage[] {
  return refs.map((ref) => {
    const path = join(dir, `${ref.id}.png`);
    return { ...ref, path, present: exists(path) };
  });
}
