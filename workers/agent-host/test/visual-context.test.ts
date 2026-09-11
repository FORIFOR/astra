/**
 * 端末内の画像の受け渡し。画素は cloud を通らず、id だけで指す。
 *
 * 見るのは:
 *   - 置き場所が Astra.app と同じ規約（ASTRA_VISUAL_CONTEXT_DIR → ASTRA_DATA_ROOT/VisualContext → Caches）
 *   - id がパスに化けない（`..` / 絶対パス / 外へ抜ける symlink）
 *   - 無いものは無いと分かる
 */
import { describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  canonicalImagePath,
  imageRefsOf,
  locateImages,
  visualContextDir,
} from '../src/visual-context.js';

describe('where the app leaves the pixels', () => {
  it('follows ASTRA_VISUAL_CONTEXT_DIR first, then ASTRA_DATA_ROOT, like the app does', () => {
    expect(
      visualContextDir({ ASTRA_VISUAL_CONTEXT_DIR: '/tmp/vc', ASTRA_DATA_ROOT: '/tmp/root' }),
    ).toBe('/tmp/vc');
    expect(visualContextDir({ ASTRA_DATA_ROOT: '/tmp/astra-root' })).toBe(
      join('/tmp/astra-root', 'VisualContext'),
    );
  });

  it('defaults to a cache, not a persistent area', () => {
    expect(visualContextDir({})).toMatch(/Library\/Caches\/Astra\/VisualContext$/);
  });
});

describe('reading image references from the cloud', () => {
  it('keeps only well-formed ids so an id can never become a path', () => {
    const refs = imageRefsOf([
      { id: 'shot-1', kind: 'screenshot', label: 'いま' },
      { id: '../secret', kind: 'screenshot', label: 'x' },
      { id: '/etc/passwd', kind: 'screenshot', label: 'x' },
      { id: 'clip-2', kind: 'clipboard_image' },
      { id: 'bad', kind: 'movie', label: 'x' },
      'not-an-object',
    ]);
    expect(refs).toEqual([
      { id: 'shot-1', kind: 'screenshot', label: 'いま' },
      { id: 'clip-2', kind: 'clipboard_image', label: 'clip-2' },
    ]);
    expect(imageRefsOf(undefined)).toEqual([]);
  });

  it('marks what is not on disk instead of dropping it', () => {
    const fs = { exists: (p: string) => p.endsWith('a.png'), realpath: (p: string) => p };
    const [a, b] = locateImages(
      [
        { id: 'a', kind: 'screenshot', label: 'A' },
        { id: 'b', kind: 'screenshot', label: 'B' },
      ],
      '/data/vc',
      fs,
    );
    expect(a).toMatchObject({ path: resolve('/data/vc/a.png'), present: true });
    expect(b).toMatchObject({ path: resolve('/data/vc/b.png'), present: false });
  });
});

describe('an id can never reach outside the hand-over folder', () => {
  it('rejects traversal and absolute ids before touching the disk', () => {
    const fs = { exists: () => true, realpath: (p: string) => p };
    expect(canonicalImagePath('../etc/passwd', '/data/vc', fs)).toBeNull();
    expect(canonicalImagePath('..', '/data/vc', fs)).toBeNull();
    expect(canonicalImagePath('/etc/passwd', '/data/vc', fs)).toBeNull();
    expect(canonicalImagePath('a/b', '/data/vc', fs)).toBeNull();
    expect(canonicalImagePath('', '/data/vc', fs)).toBeNull();
    expect(canonicalImagePath('ok-1', '/data/vc', fs)).toBe(resolve('/data/vc/ok-1.png'));
  });

  it('treats a symlink that escapes the folder as absent', () => {
    const root = mkdtempSync(join(tmpdir(), 'astra-vc-'));
    const dir = join(root, 'VisualContext');
    mkdirSync(dir);
    const outside = join(root, 'secret.png');
    writeFileSync(outside, 'not for the model');
    symlinkSync(outside, join(dir, 'esc-1.png'));
    writeFileSync(join(dir, 'in-1.png'), 'fine');
    const [escaped, inside] = locateImages(
      [
        { id: 'esc-1', kind: 'screenshot', label: 'escape' },
        { id: 'in-1', kind: 'screenshot', label: 'inside' },
      ],
      dir,
    );
    expect(escaped!.present).toBe(false);
    expect(inside!.present).toBe(true);
  });
});
