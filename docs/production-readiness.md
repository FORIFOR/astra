# Production Readiness — Astra

2026-08-27。判定と、その根拠。

**この文書の約束**: 確かめていないものを「確認済み」と書かない。
「動くはず」と「動いた」を分けて書く。

---

## 1. 判定

|                        |                                                  |
| ---------------------- | ------------------------------------------------ |
| Readiness              | **NOT_READY**（必須の外部接続が 3 つ未設定）     |
| 自動ゲート             | **PASS**（下記 2 節）                            |
| 実接続で確認済みの能力 | 4 / 8                                            |
| ManualSmoke            | NOT_RUN_BY_ASSISTANT（GUI 操作は実施していない） |

必須の能力のうち、**文字起こし・翻訳・外部サービスへの接続**が
この端末の環境では未設定のまま。設定すれば起動する状態で、
設定しないまま本番へ出すと**起動が拒否される**（そう作ってある）。

---

## 2. 自動ゲート

すべてこのリポジトリで実行した結果。

| ゲート                                         | 結果                           |
| ---------------------------------------------- | ------------------------------ |
| `pnpm typecheck`                               | PASS                           |
| `pnpm format:check`                            | PASS                           |
| `pnpm check:conventions`                       | PASS                           |
| `pnpm check:generated`                         | PASS（schema / 生成型 / 定数） |
| migration の巻き戻し                           | PASS（up → down → up）         |
| `pnpm test:db`（実 PostgreSQL）                | PASS                           |
| `pnpm build:apps`                              | PASS                           |
| `pnpm smoke`（実 Temporal・実 Redis・実 HTTP） | PASS                           |

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

「別環境で実測済み」は、`GOOGLE_CLOUD_PROJECT` を設定した状態で
実際に Google へ繋いで測った記録があるという意味。
いまの既定の環境変数では設定されていないので `not_configured` と答える。

---

## 4. 本番に出す前に、人がやること

**assistant が代わりにできないもの**だけを並べる。

1. **Google OAuth Client を作る**（デスクトップ用）。
   `ASTRA_OAUTH_GOOGLE_CLIENT_ID` に入れる。
   client secret は要らない（native app は秘密を保てない / RFC 8252 §8.5）
2. **API を有効化する**（`astra-production-506721`）:
   - `gmail.googleapis.com`
   - `calendar-json.googleapis.com`
   - `aiplatform.googleapis.com`（画像生成を使う場合）
3. **`GOOGLE_CLOUD_PROJECT` を設定**して ADC を通す
   （`gcloud auth application-default login`）
4. 端末で **Claude Code にサインイン**しておく（言語モデルと検索に使う）

これらを終えてから `ASTRA_ENV=production` で起動すると、
能力の報告が全部 `real` になり、起動が通る。

---

## 5. 確かめていないこと

**ここが、この文書でいちばん大事な節。**

- **実アカウントでの Gmail / Calendar の読み書き。**OAuth Client が無いため
  未実施。契約と経路は自動試験で通してあるが、**実物では動かしていない**
- **Vertex Imagen の実応答。**API が未有効
- **Brave / Tavily / Google Programmable Search の実応答。**鍵が無い
- **Claude Code の `not_signed_in` / `rate_limited`。**本物の出力を
  落とさずに再現できないため、分類器は単体試験のみ
- **GUI の手動確認。**assistant は画面を操作していない
- **長時間・大量の負荷。**同時実行や長い調査での挙動は測っていない

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

| 何が起きていたか                                                                                               | なぜ気づかなかったか                                                                        |
| -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `condition(fn, '1 minute')` の待ちが**一度も発火しない**。止まった仕事は永久に戻らず、承認待ちは永久に切れない | 文字列の期間を渡していた。24 時間を待つ試験が書けず、期限切れの経路は一度も通っていなかった |
| 端末へ渡す引数の検査が**200 文字超をすべて資格情報扱い**。長い本文のメールは端末へ渡せず、送れなかった         | 参照用の検査を任意の引数へ流用していた。短い引数の試験しか無かった                          |
| 実装の無い tool が `{echoed:null}` を返して**「完了」**していた                                                | 宣言と実装を突き合わせる試験が無かった                                                      |
| General Assistant に実装が無かった（§29 MVP 必須）                                                             | 同上                                                                                        |
| Gmail / Calendar の manifest が `cloud` のままで、端末で動く実装と食い違っていた                               | 宣言と surface を突き合わせる試験が無かった                                                 |

いずれも**「宣言はあるが、通っていない」**という同じ形をしている。
対策として、宣言と実装を機械的に突き合わせる試験を置いた。
