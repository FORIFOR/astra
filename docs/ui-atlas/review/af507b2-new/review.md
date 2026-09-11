# Blind pixel review — RC af507b2（judge: haiku, opus, sonnet、人手 0）

KEEP 1 / FIX_CANDIDATE 1 / NOT_ENOUGH_EVIDENCE 0 → VISUAL_IDEAL_GATE=FAIL

FIX_CANDIDATE は「有効な judge 全員が FIX」。deterministic evidence（寸法・AX・state truth）と突き合わせて初めて FIX にする。

| id | verdict | judges（model:verdict、無効は ×） | concerns |
|---|---|---|---|
| `main.home-work-context` | KEEP | haiku:KEEP opus:FIX sonnet:KEEP | consistency: 同じ「片付ける」意味の操作が、カードでは「優先ではない」、待っていることでは「外す」、返すものでは「済んだ」と語彙が割れており、しかもカード内では黒文字、下のリストでは黒文字＋青リンクが混在して、どれが主操作か読み取れない; hierarchy: 「今日、気にした方がいいこと」の3枚は同じ強さで並び、明日 15:00 期限の1枚目と期限のない「採用」が視覚的にほぼ等価。最初に何をすべきかが1枚の絵から決まらない |
| `main.home-personalization` | FIX_CANDIDATE | haiku:FIX opus:FIX sonnet:FIX | typography: 右側パネル内のフィードバック選択肢テキスト（「このとおり」「この推測を使わない」）が狭い領域に圧縮されており、視認性が低下している。; density: 右側パネルの行間・余白が詰まり気味で、各推測項目とそのフィードバック選択肢の関連性が視認しにくい。; state legibility: 「短く要点から」の「そのとおり」だけがグレーアウトし、バッジも他と違う「確認済み」になっている。承認済みで押せない状態なのか、単に無効なのかが絵から区別できない。他の行の紫塗り「そのとおり」との差も説明されていない; primary-action clarity: パネル右上の「推測 |
