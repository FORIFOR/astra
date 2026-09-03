# Home の入口の優先（盲検 Visual Discovery）

問い: Home で「新しい仕事を始める場所」が入力欄だと、初めて見る人に分かるか。
録音カード（太字 + 赤い点）がそれより先に読まれていないか。

- `panel1/prompts/judge.md` — 判定者への指示（画像だけ、観察を先に、見えなければ「見当たらない」）。
- `panel1/images/A/home.png` — 今の Home（golden `06-main-home.png` と同一）。
- `panel1/images/fixtures/F1.png` `F2.png` — 手描きの fixture（PIL で描いた合成画面。
  F1 = 入力欄が主・録音は細い link、F2 = 入力欄なし）。鍵は `panel1/answers/key.txt`。
- `panel1/results/j{1,2,3}.json` — j1 opus / j2 sonnet / j3 haiku の回答。

結果と判断は `docs/ux-benchmark/journeys/PHASE2-JOURNEY.md`
「Home の入口の優先」: 発見 3/3・録音 3/3・nav 3/3・主 3/3、最初の視線だけ 1/1/1。
A（今）を維持、B / C は作らない。
