/**
 * Markdown の軽い描画。Deepgram 公式 `@deepgram/ui` の `Response.tsx`（MIT）から、
 * 解析部分をそのまま。Tailwind の class は持ち込まず、Astra の CSS で装う。
 *
 * 外部依存なし。HTML は必ず esc() を通してから組むので、本文に HTML が混じっても実行されない。
 * 流し込み（streaming）にも向く — children を継ぎ足すだけ。
 */
import { useMemo, type ReactElement } from 'react';

export function Response({
  children,
  className,
}: {
  children: string;
  className?: string;
}): ReactElement {
  const html = useMemo(() => renderMarkdown(children), [children]);
  return (
    <div
      className={['astra-response', className].filter(Boolean).join(' ')}
      data-agent-response
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

export function renderMarkdown(md: string): string {
  const lines = md.split('\n');
  const out: string[] = [];
  let inCodeBlock = false;
  let codeLang = '';
  let codeLines: string[] = [];
  let inList = false;
  let listType: 'ul' | 'ol' = 'ul';

  const closeList = (): void => {
    if (inList) {
      out.push(listType === 'ul' ? '</ul>' : '</ol>');
      inList = false;
    }
  };

  for (const line of lines) {
    if (line.trimStart().startsWith('```')) {
      if (inCodeBlock) {
        out.push(
          `<pre data-lang="${esc(codeLang)}"><code>${esc(codeLines.join('\n'))}</code></pre>`,
        );
        codeLines = [];
        codeLang = '';
        inCodeBlock = false;
      } else {
        closeList();
        codeLang = line.trimStart().slice(3).trim();
        inCodeBlock = true;
      }
      continue;
    }
    if (inCodeBlock) {
      codeLines.push(line);
      continue;
    }
    const trimmed = line.trim();
    if (!trimmed) {
      closeList();
      continue;
    }
    const headingMatch = trimmed.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch) {
      closeList();
      const level = headingMatch[1]!.length;
      out.push(`<h${level}>${inline(headingMatch[2]!)}</h${level}>`);
      continue;
    }
    if (/^[-*+]\s/.test(trimmed)) {
      if (!inList || listType !== 'ul') {
        closeList();
        out.push('<ul>');
        inList = true;
        listType = 'ul';
      }
      out.push(`<li>${inline(trimmed.replace(/^[-*+]\s/, ''))}</li>`);
      continue;
    }
    const olMatch = trimmed.match(/^\d+\.\s(.+)$/);
    if (olMatch) {
      if (!inList || listType !== 'ol') {
        closeList();
        out.push('<ol>');
        inList = true;
        listType = 'ol';
      }
      out.push(`<li>${inline(olMatch[1]!)}</li>`);
      continue;
    }
    if (/^[-*_]{3,}$/.test(trimmed)) {
      closeList();
      out.push('<hr />');
      continue;
    }
    closeList();
    out.push(`<p>${inline(trimmed)}</p>`);
  }
  if (inCodeBlock) {
    out.push(`<pre data-lang="${esc(codeLang)}"><code>${esc(codeLines.join('\n'))}</code></pre>`);
  }
  closeList();
  return out.join('');
}

function inline(text: string): string {
  return esc(text)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/__([^_]+)__/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>')
    .replace(/_([^_]+)_/g, '<em>$1</em>')
    .replace(
      /\[([^\]]+)\]\(([^)]+)\)/g,
      '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>',
    );
}

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
