# NAV 4 タブの盲検 Blind Discovery（2026-09-04）

問い: 上位ナビを 6 本（Home / Tasks / Meetings / Library / Agents / Plugins）から
4 面（Home / Work / Library / Apps）へ戻したとき、初めて見る人が 4 つの仕事の入口を
**迷わず**見つけられるか。採用条件（本人の指定）: 4/4 が迷わず発見でき、既存 Journey が退行しない。

- A = 4 タブ（この変更後の golden `06-main-home.png` と同一の窓撮影）、B = 6 タブ（96a0405 までの golden）。
  判定者には A / B の由来を伝えていない（`panel*/answers/key.txt`）。
- 判定者 3 名（j1 opus / j2 sonnet / j3 haiku）、画像だけ、観察を先に、「見当たらない」を許す。
- 4 問: 「新しい仕事を始める」→ Home、「今動いている仕事を見る」→ Work、
  「昨日の会議を探す」→ Library、「Notion を接続する」→ Apps。

## panel1（測定器に欠陥: 左の一覧から必ず 1 語押させた）

Q1 は「いま Home を開いている」のに sidebar を押させたので、3 名とも A で Work、B で Tasks を選んだ
（Home に留まる答えが書けない）。Q3 は A で Library 2/3・見当たらない 1/3。この回は**測定器の欠陥**として記録のみ。

## panel2（測定器を直した: いま見えている画面で済むなら「この画面の『〜』を使う」と書ける）

| 問い | 期待 | A: 正答 | A: 迷わず（alt 空） | B: 正答 | B: 迷わず |
|---|---|---|---|---|---|
| Q1 新しい仕事を始める | Home（入力欄） | **3/3**（入力欄 2、「録音を始める」1） | 0/3（3 名とも alt に Work） | 2/3（j3 は Tasks を押す） | 0/3（alt Tasks / 録音） |
| Q2 今動いている仕事を見る | Work | **3/3** | 1/3（alt は Home の「録りかけ」カード ×2） | 3/3（Tasks） | 1/3（alt 同じ） |
| Q3 昨日の会議を探す | Library | **3/3** | 1/3（alt Work ×2） | 3/3（Meetings） | 2/3（alt Library ×1） |
| Q4 Notion を接続する | Apps | **3/3** | **3/3** | 3/3（Plugins） | 2/3（alt Agents ×1） |

- 発見: A は 12/12、B は 11/12。既存 Journey JA/JB/JC は変更後も success（`scripts/verify-journeys.sh`）。
- **「迷わず」は Q4 だけ 3/3。Q1 は 3 名とも Work を候補に挙げた**（「Work」が「仕事をする場所」とも読める）。
  B でも同じ形（alt Tasks）なので 4 タブで悪化したのではないが、本人の採用条件「4/4 迷わず」は**満たしていない**。
- Q2 の alt は Home の「録りかけが N 件あります」（dev のデータ置き場に selftest の断片が溜まっている状態）。
  配布版の Home には出ないので、この alt は環境の癖。
- 判断: 発見 4/4・Journey 無退行・B より悪くないので**変更は残す**。Q1 の「Work が候補に上がる」は
  記録のみ（B 案は作らない。欠陥として本人が扱うなら、その時に測定器を先に）。
