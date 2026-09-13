/**
 * すべての `var(--genie-*)` に定義があること。
 *
 * トークンは実行時に `ThemeProvider` が注す。CSS 側から見ると
 * **参照はあるが定義は同じファイルに無い**ので、綴りを間違えても
 * ビルドは通り、テストも通り、**ブラウザで初めて色が消える**。
 * ここで機械的に突き合わせる。
 */
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { TOKENS_CSS } from '../src/tokens/css.js';

const repoRoot = fileURLToPath(new URL('../../..', import.meta.url));

async function cssFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'dist') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await cssFiles(full)));
    else if (entry.name.endsWith('.css')) out.push(full);
  }
  return out;
}

/**
 * その場で与える変数。コンポーネントが inline style で入れる。
 *   `--genie-sidebar-width`  … AppShell
 *   `--genie-dock-*`         … TaskDock
 *   `--genie-bar`            … dashboard の棒
 */
const LOCALLY_SET = new Set([
  '--genie-bar',
  '--genie-sidebar-width',
  '--genie-dock-width',
  '--genie-dock-min-height',
  '--genie-dock-max-height',
]);

describe('design tokens', () => {
  it('defines every variable the stylesheets reference', async () => {
    const tokens = TOKENS_CSS;
    const defined = new Set([...tokens.matchAll(/(--genie-[a-z0-9-]+)\s*:/g)].map((m) => m[1]!));

    const files = [
      ...(await cssFiles(path.join(repoRoot, 'apps/desktop/src'))),
      ...(await cssFiles(path.join(repoRoot, 'apps/share-web/src'))),
    ];
    expect(files.length).toBeGreaterThan(0);

    const missing: string[] = [];
    for (const file of files) {
      const css = await readFile(file, 'utf8');
      // `var(--x, fallback)` は落ちても代わりが出るので数えない。
      // 危ないのは**代わりの無い参照**で、綴りを間違えるとその宣言ごと消える。
      for (const match of css.matchAll(/var\((--genie-[a-z0-9-]+)\s*([,)])/g)) {
        const name = match[1]!;
        const hasFallback = match[2] === ',';
        if (hasFallback || defined.has(name) || LOCALLY_SET.has(name)) continue;
        missing.push(`${path.relative(repoRoot, file)} → ${name}`);
      }
    }

    // 綴り間違いは、ブラウザでしか見えない形で壊れる
    expect([...new Set(missing)].sort()).toEqual([]);
  });

  it('catches a typo that has no fallback', async () => {
    // 検査そのものが効いていることを確かめる。
    // 効かない検査は、通っているのに守っていない
    const defined = new Set(
      [...TOKENS_CSS.matchAll(/(--genie-[a-z0-9-]+)\s*:/g)].map((m) => m[1]!),
    );
    const sample = '.x { color: var(--genie-color-canvasss); }';
    const found = [...sample.matchAll(/var\((--genie-[a-z0-9-]+)\s*([,)])/g)].filter(
      (m) => m[2] === ')' && !defined.has(m[1]!),
    );
    expect(found.map((m) => m[1])).toEqual(['--genie-color-canvasss']);
  });

  it('emits the tokens the components rely on', () => {
    // floating surface（Dock / HUD）。値は Deepgram の dark scheme
    expect(TOKENS_CSS).toContain('--genie-float-background: rgba(24, 24, 28, 0.92);');
    expect(TOKENS_CSS).toContain('--genie-float-padding: 16px;');
    const tokens = TOKENS_CSS;
    for (const name of [
      '--genie-color-canvas',
      '--genie-color-surface',
      '--genie-color-surface-raised',
      '--genie-color-accent-on',
      '--genie-color-focus-ring',
      '--genie-space-base',
      '--genie-radius-standard',
    ]) {
      expect(tokens, name).toContain(name);
    }
  });
});
