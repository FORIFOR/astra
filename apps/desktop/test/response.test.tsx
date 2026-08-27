/** vendor/deepgram-ui/Response: markdown を描き、HTML は実行しない。 */
import { describe, expect, it } from 'vitest';
import { renderMarkdown } from '../src/vendor/deepgram-ui/Response.js';

describe('renderMarkdown', () => {
  it('renders headings, lists, emphasis and links', () => {
    const html = renderMarkdown(
      '# 要点\n\n1. **A社** は 10 月\n2. _懸念_ は初期費用\n\n- [出典](https://x.example)',
    );
    expect(html).toContain('<h1>要点</h1>');
    expect(html).toContain('<ol><li><strong>A社</strong> は 10 月</li>');
    expect(html).toContain('<em>懸念</em>');
    expect(html).toContain(
      '<a href="https://x.example" target="_blank" rel="noopener noreferrer">出典</a>',
    );
  });

  it('escapes raw html so nothing runs', () => {
    const html = renderMarkdown('<script>alert(1)</script> & "q"');
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('&amp;');
  });

  it('keeps code blocks verbatim', () => {
    const html = renderMarkdown('```ts\nconst a = 1 < 2;\n```');
    expect(html).toContain('<pre data-lang="ts"><code>const a = 1 &lt; 2;</code></pre>');
  });
});
