/**
 * 端末内の画像の受け渡し。画素は cloud を通らず、id だけで指す。
 *
 * 見るのは:
 *   - 置き場所が Astra.app と同じ規約（ASTRA_DATA_ROOT → Application Support/Astra）
 *   - id がパスに化けない
 *   - 無いものは無いと分かる
 */
import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { imageRefsOf, locateImages, visualContextDir } from '../src/visual-context.js';

describe('where the app leaves the pixels', () => {
  it('follows ASTRA_DATA_ROOT when set, like the app does', () => {
    expect(visualContextDir({ ASTRA_DATA_ROOT: '/tmp/astra-root' })).toBe(
      join('/tmp/astra-root', 'visual-context'),
    );
  });

  it('defaults to Application Support/Astra', () => {
    expect(visualContextDir({})).toMatch(/Library\/Application Support\/Astra\/visual-context$/);
  });
});

describe('reading image references from the cloud', () => {
  it('keeps only well-formed ids so an id can never become a path', () => {
    const refs = imageRefsOf([
      { id: 'shot-1', kind: 'screenshot', label: 'いま' },
      { id: '../secret', kind: 'screenshot', label: 'x' },
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
    const [a, b] = locateImages(
      [
        { id: 'a', kind: 'screenshot', label: 'A' },
        { id: 'b', kind: 'screenshot', label: 'B' },
      ],
      '/data/visual-context',
      (path) => path.endsWith('a.png'),
    );
    expect(a).toMatchObject({ path: '/data/visual-context/a.png', present: true });
    expect(b).toMatchObject({ path: '/data/visual-context/b.png', present: false });
  });
});
