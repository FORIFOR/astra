import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'happy-dom',
    globals: false,
    // CSS は読み込まない。UI-0 の検証対象は構造・キーボード操作・aria であって、
    // ピクセルではない（ピクセルは別途 visual regression でやる）。
    css: false,
    setupFiles: ['./test/setup.ts'],
  },
});
