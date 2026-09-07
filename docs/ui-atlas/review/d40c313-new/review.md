# Blind pixel review — RC d40c313（judge: haiku, opus, sonnet、人手 0）

KEEP 1 / FIX_CANDIDATE 1 / NOT_ENOUGH_EVIDENCE 0 → VISUAL_IDEAL_GATE=FAIL

FIX_CANDIDATE は「有効な judge 全員が FIX」。deterministic evidence（寸法・AX・state truth）と突き合わせて初めて FIX にする。

| id | verdict | judges（model:verdict、無効は ×） | concerns |
|---|---|---|---|
| `main.home-personalization` | FIX_CANDIDATE | haiku:FIX opus:FIX sonnet:FIX | contrast: Gray text (e.g., descriptive text in right sidebar like 'Astra が提している あなたのの情報') has insufficient contrast against the light background; density: Right sidebar packs too much content (section headers, small buttons, status indicators) in narrow column; scrollbar indicates overflow; consiste |
| `main.home-work-context` | KEEP | haiku:KEEP opus:FIX sonnet:FIX | alignment: カード本文は左端に寄り、操作リンクは右端に張り付いて、間に本文 1 行分以上の空白が空く。ワイド幅では視線が横に飛び、どの操作がどのカードのものか目で追う必要がある; consistency: 同じ『やること』系の一覧なのに、上 3 件はカード（枠＋余白）、下 4 件は枠なしの 1 行で、視覚的な重みの差が内容の重要度と対応しているか読み取れない; screen occupation: パネルを閉じた分の横幅がレイアウトに再配分されず、ウィンドウ右半分がほぼ未使用の空白になっている |
