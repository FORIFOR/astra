# Blind supremacy review — RC a93d4f8（8 軸・自己採点・人手 0）

SUPREME 0 / COMPETITIVE 7 / BELOW_BAR 1 / NEE 2 → VISUAL_SUPREMACY(blind)=FAIL

BELOW_BAR は「有効 judge 全員が BELOW_BAR」。1 人の趣味では落とさない。A/B 競合比較は competitor 画像が要る（AUTOMATION_MISSING）。

| id | verdict | judges | avg(craft/dist/hier) | ai_look |
|---|---|---|---|---|
| `screenshot.detected` | COMPETITIVE | haiku:COMP× opus:COMP sonnet:COMP | 4/3/4 | Raycast/CleanShot系でよく見るダークHUDトーストの定型パターン |
| `guided-setup.intro` | NOT_ENOUGH_EVIDENCE | haiku:COMP× opus:BELO sonnet:BELO× | 3/2/3 | 行き先の無い指示文だけで解決手段を持たせない、説明過多寄りの文面 |
| `guided-setup.target-found` | COMPETITIVE | haiku:SUPR opus:BELO sonnet:BELO | 3.33/2.67/3.67 | OSの画面をそのまま借りて吹き出しを載せただけの、自製UIとしての設計が無いガイド |
| `guided-setup.denied` | COMPETITIVE | haiku:COMP opus:COMP sonnet:COMP | 3.67/2.67/4 |  |
| `guided-setup.repositioned` | COMPETITIVE | haiku:SUPR opus:BELO sonnet:BELO | 3.33/2.67/3.67 | OS画面に吹き出しを重ねただけのテンプレ的オンボーディング |
| `guided-setup.target-missing` | COMPETITIVE | haiku:COMP× opus:COMP sonnet:COMP | 4/3/4 |  |
| `guided-setup.target-highlighted` | BELOW_BAR | haiku:COMP× opus:BELO sonnet:BELO | 2/2/2.5 | 文脈（行ラベル）を欠いたまま指示文だけを置く、説明先行の作り; generic rounded speech-bubble coachmark with no clear anchor arrow tip touching the cont |
| `screenshot.attached-cloud` | COMPETITIVE | haiku:COMP× opus:COMP sonnet:COMP | 3.5/2.5/4 | generic placeholder icon standing in for what should be a real content preview |
| `guided-setup.granted` | NOT_ENOUGH_EVIDENCE | haiku:SUPR× opus:BELO× sonnet:BELO× | -/-/- |  |
| `guided-setup.target-add` | COMPETITIVE | haiku:COMP opus:BELO sonnet:BELO | 3.33/2/4 | OS 標準画面に後付けの指示バブルを重ねる、チュートリアル的な説明過多の被せ方; unanchored tooltip with no clear pointer to its target, relying on the user to  |
