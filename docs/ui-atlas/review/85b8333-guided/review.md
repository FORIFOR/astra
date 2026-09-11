# Blind pixel review — RC 85b8333（judge: haiku, opus, sonnet、人手 0）

KEEP 5 / FIX_CANDIDATE 0 / NOT_ENOUGH_EVIDENCE 0 → VISUAL_IDEAL_GATE=PASS

FIX_CANDIDATE は「有効な judge 全員が FIX」。deterministic evidence（寸法・AX・state truth）と突き合わせて初めて FIX にする。

| id | verdict | judges（model:verdict、無効は ×） | concerns |
|---|---|---|---|
| `guided-setup.intro` | KEEP | haiku:KEEP opus:KEEP sonnet:KEEP |  |
| `guided-setup.denied` | KEEP | haiku:FIX opus:KEEP sonnet:KEEP | typography: Incorrect verb form in button text '試く' should be '試す' |
| `guided-setup.granted` | KEEP | haiku:KEEP opus:KEEP sonnet:KEEP |  |
| `guided-setup.target-missing` | KEEP | haiku:KEEP opus:FIX sonnet:KEEP | consistency: 同じ「失敗して手動対応が必要」という種類の知らせなのに、0474 には警告アイコンが付き、この画面には付いていない。状態の重さが見た目で揃っていない。; state legibility: アイコンも色も通常の案内と同じため、これが「うまくいかなかった」状態なのか「これからやる案内」なのか、文を読み切るまで見分けがつかない。 |
| `guided-setup.target-highlighted` | KEEP | haiku:KEEP opus:FIX sonnet:FIX | trust-provenance: 一覧に表示されているアプリ名が「AstraDbg」で、他の画面の製品名「Astra」と一致しない。利用者はどれをオンにすべきか確信が持てず、デバッグ用の内部名が製品として露出している。; density: 案内の吹き出しがリスト行の上に重ねて置かれ、その行の内容を覆っている。下のアプリ名とトグルの対応関係が見えなくなる。; trust-provenance: システム設定の一覧に製品名「Astra」ではなく内部/デバッグビルド名「AstraDbg」が表示され、他画面のブランド表記と食い違っている; screen occupation: 再起動案内のツールチッ |
