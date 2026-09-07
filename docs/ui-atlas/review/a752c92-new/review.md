# Blind pixel review — RC a752c92（judge: haiku, opus, sonnet、人手 0）

KEEP 1 / FIX_CANDIDATE 1 / NOT_ENOUGH_EVIDENCE 0 → VISUAL_IDEAL_GATE=FAIL

FIX_CANDIDATE は「有効な judge 全員が FIX」。deterministic evidence（寸法・AX・state truth）と突き合わせて初めて FIX にする。

| id | verdict | judges（model:verdict、無効は ×） | concerns |
|---|---|---|---|
| `main.home-work-context` | KEEP | haiku:KEEP opus:KEEP sonnet:FIX | screen occupation: サイドバーとコンテンツの後、ウィンドウ右側におよそ画面幅の3割ほどが恒常的な空白になっており、レイアウトが左に偏って見える |
| `main.home-personalization` | FIX_CANDIDATE | haiku:FIX opus:FIX sonnet:FIX | state legibility: Toggle controls styled as plain text links rather than buttons, reducing discoverability of interactivity; hierarchy: Unclear relationship between recommendation headers, source attributions, and toggle actions; consistency: 同じ「項目＋操作」行なのに操作の並びが2種類ある。「短く要点から」は右にラベル「確認済み」だけで、「この推測を使わ |
