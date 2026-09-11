# Blind pixel review — RC 0d089bc（judge: haiku, opus, sonnet、人手 0）

KEEP 1 / FIX_CANDIDATE 1 / NOT_ENOUGH_EVIDENCE 0 → VISUAL_IDEAL_GATE=FAIL

FIX_CANDIDATE は「有効な judge 全員が FIX」。deterministic evidence（寸法・AX・state truth）と突き合わせて初めて FIX にする。

| id | verdict | judges（model:verdict、無効は ×） | concerns |
|---|---|---|---|
| `main.home-personalization` | FIX_CANDIDATE | haiku:FIX opus:FIX× sonnet:FIX | density: Right sidebar contains too much concurrent information (multiple task categories, buttons, links, status indicators) creating visual clutter and cognitive load; state legibility: Action buttons in right sidebar (その止める, この推測を使わない) have identical blue styling but unclear semantic difference;  |
| `main.home-work-context` | KEEP | haiku:KEEP opus:FIX sonnet:FIX | alignment: 右上のパネル切替アイコンが左の「Home」見出しの行と揃っておらず、上端に置かれた要素同士の基準線が合っていない; density: 上半分はカードで余白が広く、下半分（待っていること／返すもの）は枠なしの詰まった行で、同じ画面内で情報の粒度が急に切り替わる; density: 右パネルを閉じて広がった横幅が単なる空白として残り、各行の中央に大きな未使用スペースができている(コンテンツが再レイアウトされていない) |
