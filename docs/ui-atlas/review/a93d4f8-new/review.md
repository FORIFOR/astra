# Blind pixel review — RC a93d4f8（judge: haiku, opus, sonnet、人手 0）

KEEP 7 / FIX_CANDIDATE 2 / NOT_ENOUGH_EVIDENCE 1 → VISUAL_IDEAL_GATE=FAIL

FIX_CANDIDATE は「有効な judge 全員が FIX」。deterministic evidence（寸法・AX・state truth）と突き合わせて初めて FIX にする。

| id | verdict | judges（model:verdict、無効は ×） | concerns |
|---|---|---|---|
| `screenshot.detected` | KEEP | haiku:KEEP× opus:KEEP sonnet:FIX | consistency: 同系統の通知(5D27)には閉じるボタンがあるのに、この通知には無く操作可否が不揃い |
| `guided-setup.granted` | NOT_ENOUGH_EVIDENCE | haiku:KEEP× opus:KEEP× sonnet:FIX | consistency: ラベルのない緑チェックアイコンがピルと分離して配置され、グルーピングと役割が不明瞭 |
| `screenshot.attached-cloud` | KEEP | haiku:KEEP opus:KEEP sonnet:KEEP |  |
| `guided-setup.target-missing` | KEEP | haiku:KEEP opus:KEEP sonnet:FIX | primary-action clarity: ラベルの無い丸アイコンボタンが本体ピルから離れて配置され、押した際の動作が読み取れない |
| `guided-setup.target-found` | KEEP | haiku:KEEP opus:FIX sonnet:FIX | alignment: 誘導の吹き出しがウィンドウ境界の外にはみ出し、ウィンドウ枠と重なって配置されている。矢印は左を指すが対象トグルまで距離があり、指し先が絵の上でつながっていない。; trust-provenance: オンにするよう求めているアプリ名が「AstraDbg」で、開発／デバッグビルドの名前に見える。ユーザーが画面収録許可を与える相手として同定しづらい。; trust-provenance: 権限一覧に製品名ではなく「AstraDbg」「2.1.260」のような開発用/バージョン番号名が表示され、他画面の「Astra」という案内文言と食い違うためユーザーが対象行を見つけにくい |
| `guided-setup.intro` | KEEP | haiku:KEEP opus:FIX sonnet:FIX | primary-action clarity: システム設定を開くよう指示しているが、画面上の操作子は閉じる × だけで、指示を実行する手段が用意されていない。; error-recovery clarity: 権限が無いという問題提起で終わっており、解決までの導線が絵の中に存在しない。閉じると手がかりが消える。; consistency: 5D42と同じ趣旨の依頼なのに「システム設定を開く」ショートカットボタンが無く、対応手段が画面によって不揃い |
| `guided-setup.repositioned` | KEEP | haiku:KEEP opus:FIX sonnet:FIX | state legibility: 指示は「オンにしてください」だが、ハイライトされたトグルの見え方が同一画面内の OFF（VoiceOS）とも ON（他の青いトグル）とも一致せず、今どちらなのか断定できない; alignment: 指示の矢印と対象トグルの間に、説明のつかない濃い縦帯が挟まっており、指し示しの線が途切れて見える; state legibility: トグルの見た目上の状態(オン相当の青色)と案内文(オンにしてください)が食い違って見える |
| `guided-setup.target-add` | KEEP | haiku:KEEP opus:FIX sonnet:FIX | alignment: 「↑」が対象の「+」ボタンの真下に無く、左に大きくずれているため、どの要素を指しているのか矢印だけでは分からない; consistency: 指示中の名称「Astra」と一覧の「AstraDbg」が一致せず、同じ対象を指すのか判断できない; consistency: 既存項目名『AstraDbg』と案内文の『Astra』という表記が一致せず、同じアプリを指すのか別の追加項目なのか不明瞭 |
| `guided-setup.target-highlighted` | FIX_CANDIDATE | haiku:KEEP× opus:FIX sonnet:FIX | state legibility: 対象トグルが既にオンの見た目（塗り＋ノブ右）なのに『オンにしてください』と書かれており、指示と現在状態が矛盾して読める; alignment: 吹き出しの矢印と対象の間に説明のつかない縦帯が挟まり、対応関係が視覚的に切れている; state legibility: トグルの視覚状態(オン相当)と指示文(オンにしてください)が矛盾して見える |
| `guided-setup.denied` | FIX_CANDIDATE | haiku:FIX opus:FIX sonnet:FIX× | alignment: エラーアイコン（赤い感嘆符）がテキストとメッセージボックスから分離し、垂直・水平アライメントが取れていない; hierarchy: 感嘆符アイコンと情報テキストの視覚的な関係が弱く、エラーメッセージとしての統一感が失われている; alignment: エラーを示す「!」アイコンが通知バーから離れて右側に単独で浮いており、メッセージとの結び付きが視覚的に切れている; contrast: 唯一の復帰アクション「システム設定を開く」の文字と塗りの明度差が小さく、隣の「×」より弱く見える |
