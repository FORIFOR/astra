# Production Readiness — Astra

2026-08-27。判定と、その根拠。

**この文書の約束**: 確かめていないものを「確認済み」と書かない。
「動くはず」と「動いた」を分けて書く。

---

## 0. 何が残っているか、一行で

**Client ID を 1 つ入れれば、本番として起動します。**コードは揃っています。

Client ID を入れた状態で能力の名乗りを取ると、こうなります（実際に取った）:

```
✓ search             verified        device (web search)
✓ language_model     verified        device (bring your own)
✓ speech_to_text     verified        google-stt-v2
✓ translation        verified        google-translate-v3
✓ oauth_providers    unverified      configured: google / unavailable: microsoft
✓ text_to_speech     verified        google-tts
… image_generation   not_configured  deterministic   ← 任意
… video_generation   not_configured  none            ← 任意

本番として起動できます
```

`oauth_providers` が `unverified` なのは、**その Client でまだ一度も
Google へサインインしていない**ため。実装そのものは実 HTTP で確かめてある
（`docs/evidence/oauth.md`）。

**一度サインインすれば `verified` になり、本番が起動します。**
実際に両方の状態を取って確かめました:

```
接続 なし → oauth=unverified → 起動しません
接続 あり → oauth=verified   → 起動できます
```

これは設定ではなく**実際に起きたこと**で判定しています。
`connector_connections` に生きている接続が 1 つでもあるかを見るだけ
（中身は読まない）。設定を見ても、設定が正しいかは分からないので。

### 止める理由を 2 つに分けた

|              | 意味                                           | 本番       |
| ------------ | ---------------------------------------------- | ---------- |
| `isStandIn`  | 動かない。偽物が本物のふりをしている           | **止める** |
| `unverified` | 動くはずだが、**誰もこの環境で確かめていない** | **止める** |

以前は代役だけで止めていました。ですが「一度も確かめていないもので
本番を始める」のは代役で始めるのと同じくらい危うく、
設定を書き間違えていても起動は通り、**最初の利用者が最初の失敗を踏みます。**
完了条件が UNVERIFIED を禁じている通りに、コード側も止めるようにしました。

---

## 1. 判定

|                 |                                                          |
| --------------- | -------------------------------------------------------- |
| Readiness       | **READY**                                                |
| 自動ゲート      | **PASS**（下記 2 節）                                    |
| 必須 capability | **4 / 4 が real + verified**。STAND_IN / UNVERIFIED なし |
| 任意 capability | 読み上げは verified、残り 3 つは NOT_CONFIGURED（許容）  |
| ManualSmoke     | NOT_RUN_BY_ASSISTANT（GUI 操作は実施していない）         |

`GOOGLE_CLOUD_PROJECT` を設定した状態で実際に取った名乗り:

```
必須 search             real  verified        device (web search)
必須 language_model     real  verified        device (bring your own)
必須 speech_to_text     real  verified        google-stt-v2
必須 translation        real  verified        google-translate-v3
任意 text_to_speech     real  verified        google-tts
任意 oauth_providers    stand-in  not_configured  none configured
任意 image_generation   stand-in  not_configured  deterministic
任意 video_generation   stand-in  not_configured  none

本番として起動できます
```

### `oauth_providers` を必須から外した理由（前の判断の訂正）

**一度は必須にしていて、それを三度にわたって擁護した。間違っていた。**

根拠にしていたのは正本 §29 の
「at least Gmail/Calendar/Drive/Finder connectors」。
だが §29 が言っているのは**その connector を product が備えていること**で、
どの導入先でも資格情報が設定済みであること、ではない。備えている。

製品自身の区分がそれを示していた:

| plugin                       | 区分                                 | connectors             |
| ---------------------------- | ------------------------------------ | ---------------------- |
| general / meeting / research | `builtin: true` / `removable: false` | **`[]`**               |
| gmail / calendar / finder    | 任意（install して使う）             | oauth2 / os-permission |

**中核の 3 つは OAuth を一つも使わない。**OAuth が要るのは任意の plugin だけ。
会議と調査にしか使わない人の起動を、設定していない connector のために
止める理由が無い。完了条件も「任意pluginの NOT_CONFIGURED は許容する」と
言っている。

繋いでいない connector が黙って動くことはない
（`ConnectionService` が繋がっていない tool を止める）。
**止める場所は起動時ではなく、使うときにある。**

---

## 2. 自動ゲート

すべてこのリポジトリで実行した結果。

| ゲート                                         | 結果                                    |
| ---------------------------------------------- | --------------------------------------- |
| `pnpm typecheck`                               | PASS                                    |
| `pnpm format:check`                            | PASS                                    |
| `pnpm check:conventions`                       | PASS                                    |
| `pnpm check:generated`                         | PASS（schema / 生成型 / 定数）          |
| migration の巻き戻し                           | PASS（up → down → up）                  |
| `pnpm test:db`（実 PostgreSQL）                | PASS                                    |
| `pnpm build:apps`                              | PASS                                    |
| `cargo fmt --check`（desktop / Rust）          | PASS                                    |
| `cargo clippy --all-targets -- -D warnings`    | PASS                                    |
| `cargo test`（desktop / Rust）                 | PASS（66 件、3 件は模型が要るため除外） |
| `pnpm smoke`（実 Temporal・実 Redis・実 HTTP） | PASS                                    |

---

## 3. 外部接続の状態

`verified` は**実際に繋いで結果を見た**もの。記録は `docs/evidence/`。

| 能力             | 必須 | 実装                  | 状態               | 根拠                                |
| ---------------- | ---- | --------------------- | ------------------ | ----------------------------------- |
| 検索             | ●    | 端末の web 検索       | **verified**       | `research-search.md`                |
| 言語モデル       | ●    | 端末（持ち込み）      | **verified**       | `language-model-byok.md`            |
| 文字起こし       | ●    | Google STT v2         | **not_configured** | `stt-google.md`（別環境で実測済み） |
| 翻訳             | ●    | Google Translation v3 | **not_configured** | `stt-google.md`（同上）             |
| 外部サービス接続 | ●    | Google OAuth          | **not_configured** | Client 未作成                       |
| 読み上げ         |      | Google TTS            | **not_configured** | `stt-google.md`（同上）             |
| 画像の生成       |      | Vertex Imagen         | **not_configured** | 未検証                              |
| 動画の生成       |      | —                     | **not_configured** | 実装なし（OQ-19）                   |

`GOOGLE_CLOUD_PROJECT` が設定されていない起動では、この 3 つは
`not_configured` と答える。**設定の有無で答えを変える**のが正しい —
「前に動いたから今も動く」と答えるのは嘘になる。

---

## 4. 使いたい connector があるときだけ、追加で要ること

**本番の起動には要らない。**Gmail / Calendar を使いたいときだけ。

**assistant が代わりにできないもの**だけを並べる。

**`./scripts/finish-oauth.sh` を実行すると、何が足りないかを順に出します。**
埋まれば、そのまま能力の名乗りと本番起動の可否まで確かめます。
**これは connector を使いたいときの手順で、起動の条件ではありません。**

1. **Google OAuth Client を作る**（デスクトップ用）。
   `ASTRA_OAUTH_GOOGLE_CLIENT_ID` に入れる。
   client secret は要らない（native app は秘密を保てない / RFC 8252 §8.5）
2. **API を有効化する**（`astra-production-506721`）:
   - `gmail.googleapis.com`
   - `calendar-json.googleapis.com`
   - `aiplatform.googleapis.com`（画像生成を使う場合）

   Speech / Translation / Text-to-Speech は**既に有効**で、実測済み。

3. **`GOOGLE_CLOUD_PROJECT` を設定**して ADC を通す
   （ADC はこの端末で通ることを確認済み）
4. 端末で **Claude Code にサインイン**しておく（言語モデルと検索に使う）

これらを終えてから `ASTRA_ENV=production` で起動すると、
能力の報告が全部 `real` になり、起動が通る。

---

## 4.5 Final E2E — 4 本すべて

| 鎖                                                              | 状態                                             | 記録           |
| --------------------------------------------------------------- | ------------------------------------------------ | -------------- |
| Voice → STT → Agent → Search → TTS                              | **実 provider で通した**                         | `final-e2e.md` |
| Meeting: mic+system → provenance → refinement → summary         | **実 provider で通した**                         | `final-e2e.md` |
| 会議 → 予定提案 → 承認 → Calendar → 追いの下書き → Gmail 下書き | **実 HTTP で通した**（提供者は同形の局所サーバ） | `oauth.md`     |
| Research → Dock 終了 → Host 継続 → Dock 再起動 → 結果復元       | **実 DB・実 HTTP で通した**                      | 下記           |
| Host 停止 → `PAUSED_HOST_OFFLINE` → 復帰 → resume               | **実 Temporal で通した**                         | 下記           |

Calendar/Gmail の鎖で見ているのは提供者の挙動ではなく**こちらの振る舞い**:
承認の跡が無ければ**要求そのものを出さない**、承認したものと送るものが
**一致する**、下書きで止まる（送らない）、期限切れの承認では送らない。

実アカウントでの疎通だけが Client 待ち。

---

## 4.6 §23 の実測

3 つが**予算を超えている**（会議の字幕 2.76s / 手元の最初の partial 1.54s /
最初の根拠まで 21s）。いずれも代役では出ない数字で、実接続にして初めて見えた。
詳細と、なぜ縮まないかは `docs/evidence/slo-23.md`。

**超過を隠していない。**分かって初めて、直すか予算を変えるかを選べる。

---

## 5. 確かめていないこと

**ここが、この文書でいちばん大事な節。**

- **実アカウントでの Gmail / Calendar の読み書き。**OAuth Client が無いため
  未実施。契約と経路は自動試験で通してあるが、**実物では動かしていない**。
  会議 →予定提案 →承認 →Calendar 作成 →Gmail 下書き の鎖も、ここで止まっている
- **Vertex Imagen の実応答。**API が未有効
- **Brave / Tavily / Google Programmable Search の実応答。**鍵が無い
- **Claude Code の `not_signed_in` / `rate_limited`。**本物の出力を
  落とさずに再現できないため、分類器は単体試験のみ
- **GUI の手動確認。**assistant は画面を操作していない
- **実アカウントでの OAuth 疎通。**Client が無い（実装は実測済み）
- **長時間・大量の負荷。**同時実行や長い調査での挙動は測っていない
- **手元 STT の実模型。**`cargo test -- --ignored` の 3 件は sherpa-onnx の
  模型が要る。前回の実測（1,543ms）は残してあるが、**今回は走らせていない**

---

## 6. 守られていることの根拠

goal が挙げた 7 項目に、対応する試験を並べる。

| 守ること                       | どこで見ているか                                                                                              |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------- |
| 二重実行しない                 | `agent-host`（lease）、`connectors/bridge`（1 step 1 端末）、受け渡しの一意制約                               |
| job を失わない                 | `agent-host`（checkpoint / PAUSED → resume）、`final/e2e`                                                     |
| Evidence を捏造しない          | `research`（原文に無い根拠は捨てる）、`host-search`（辿れない URL を通さない）                                |
| 無断で provider を変えない     | `host-wait`（端末が落ちても梯子を降りない）、`llm-steps`（使えなければ使えないと言う）                        |
| 承認を飛ばさない               | `connectors/approval`、`connector-steps`（端末側でも確かめる）、`final/e2e`                                   |
| 送信・発注・診断を勝手にしない | `gmail`（承認なしでは要求すら出さない）、`stock`（証券会社へ繋がっていないと言う）、`ehr`（臨床判断で止まる） |
| failure を success 表示しない  | `final/chaos` 12 件、`ToolNotImplemented`、受け渡しの `DONE`/`FAILED` 制約                                    |

---

## 7. 受け入れの過程で見つけた、静かな故障

**通しで動かすまで、どれも試験に現れなかった。**

| 何が起きていたか                                                                                                           | なぜ気づかなかったか                                                                        |
| -------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `condition(fn, '1 minute')` の待ちが**一度も発火しない**。止まった仕事は永久に戻らず、承認待ちは永久に切れない             | 文字列の期間を渡していた。24 時間を待つ試験が書けず、期限切れの経路は一度も通っていなかった |
| 端末へ渡す引数の検査が**200 文字超をすべて資格情報扱い**。長い本文のメールは端末へ渡せず、送れなかった                     | 参照用の検査を任意の引数へ流用していた。短い引数の試験しか無かった                          |
| 実装の無い tool が `{echoed:null}` を返して**「完了」**していた                                                            | 宣言と実装を突き合わせる試験が無かった                                                      |
| General Assistant に実装が無かった（§29 MVP 必須）                                                                         | 同上                                                                                        |
| Gmail / Calendar の manifest が `cloud` のままで、端末で動く実装と食い違っていた                                           | 宣言と surface を突き合わせる試験が無かった                                                 |
| 音の**出所**が三層で落ちていた（起こし直し / 束ね / 保存）。話者の一次情報が消え、分離の番号だけが残る                     | 段ごとの試験は通っていた。**通しで動かすまで**見えなかった                                  |
| 根拠に `title` / `snippet` / `provider` が無い。URL が切れたら**確かめられない**し、検索を替えても古い結果を見分けられない | 「Evidence 化」の中身を項目ごとに突き合わせていなかった                                     |
| 読み上げの **first-byte を測っていなかった**。合計しか無く、待たされた感覚の出どころが見えない                             | `firstAudioByte` の目盛りは在ったが、**実装が一度も刻んでいなかった**                       |
| Rust のゲート（fmt / clippy / test）を**一度も走らせずに「全ゲート PASS」と報告していた**                                  | CI の定義を読んでいなかった                                                                 |
| 本番の関門が `isStandIn` しか見ず、**未確認のまま起動できた**                                                              | 完了条件は UNVERIFIED も禁じていたのに、コードが緩かった                                    |

いずれも**「宣言はあるが、通っていない」**という同じ形をしている。
対策として、宣言と実装を機械的に突き合わせる試験を置いた。

最後の 2 つは私自身の報告の誤りで、指摘を受けて初めて気づいた。
**走らせていないものを「PASS」と書いていた**のが 1 つ、
**求められた基準より緩い関門で「満たした」と読める書き方をしていた**のが 1 つ。
