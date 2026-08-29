// §9 ページから **必要な部分だけ** を取り出す。DOM 全文は送らない。
//
// 全文を毎回送ると、量で遅くなるだけでなく、見せるつもりのなかった部分まで出ていく。
// ここで送るのは「いま見えている範囲」と「選択」と「focus している要素」に限る。

const MAX_BLOCK = 400; // 1 ブロックの上限（文字）
const MAX_BLOCKS = 12; // ブロック数の上限
const MAX_SELECTION = 2000;

/** 画面に入っているか（見えていないものは文脈ではない）。 */
function isVisible(el) {
  const r = el.getBoundingClientRect();
  return r.height > 0 && r.bottom > 0 && r.top < window.innerHeight;
}

function semanticBlocks() {
  const nodes = document.querySelectorAll(
    '[data-block-id], [role="textbox"], h1, h2, h3, li, p, td',
  );
  const out = [];
  for (const el of nodes) {
    if (out.length >= MAX_BLOCKS) break;
    if (!isVisible(el)) continue;
    const text = (el.innerText || '').trim();
    if (!text) continue;
    out.push({
      id: el.getAttribute('data-block-id') || null,
      role: el.tagName.toLowerCase(),
      text: text.slice(0, MAX_BLOCK),
    });
  }
  return out;
}

function focusedElement() {
  const el = document.activeElement;
  if (!el || el === document.body) return null;
  return {
    role: el.getAttribute('role') || el.tagName.toLowerCase(),
    id: el.getAttribute('data-block-id') || null,
  };
}

export function collect() {
  return {
    url: location.href,
    title: document.title,
    selection: String(window.getSelection() || '').slice(0, MAX_SELECTION),
    focusedElement: focusedElement(),
    semanticBlocks: semanticBlocks(),
  };
}

chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  if (msg?.type === 'astra.collect') {
    reply(collect());
    return true;
  }
  return false;
});
