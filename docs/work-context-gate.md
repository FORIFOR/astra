# WORK_CONTEXT_GATE（2026-09-07）— Work Context / Personalization Layer

「何を質問されたかだけ知っている AI」ではなく、「その人が今何の仕事を抱え、誰を待ち、何を返さなければならず、
今日どこに時間を使うべきかを**出所つきで**理解している AI」のための層。人はクリックも判定もしない
（HUMAN_INTERVENTION = 0）。測定器は `scripts/reality/run-work-context-gate.sh` が束ねる。

## 流れ（実装の場所）

| 段                     | 場所                                                                                                                        | 守ること                                                              |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| connector（生データ）  | `services/connectors/src/{gmail,calendar,microsoft}.ts`                                                                     | 判断しない。一覧は本文を取らない（metadata / `$select` に body 無し） |
| 正規化 → WorkArtifact  | `services/connectors/src/normalize.ts`、契約 `packages/contracts/src/work.ts`                                               | 抜粋 <= 500 字、出所 <= 200 字、semantic は null、時刻は UTC          |
| 端末の同期             | `workers/agent-host/src/work-sync.ts`（`ASTRA_WORK_SYNC=off` で停止）                                                       | 繋いだ source だけ、読む許可が無ければ読まない、1 つ落ちても他は進む  |
| 意味づけ（端末の LLM） | `workers/agent-host/src/llm-steps.ts` `llm.classify_email`                                                                  | 件名 + 抜粋だけ渡す。期限を作らせない。読めない返事は捨てる           |
| 規則の代役             | `services/world-model/src/work/semantic.ts`（graph.ts が email/message にだけ補う）                                         | 賢くしない（確度 0.4）。LLM の結果は上書きしない                      |
| Work Graph             | `services/world-model/src/work/graph.ts`                                                                                    | 案件に寄せる（明示 → thread → Jaccard）、owed / waiting / week        |
| Work Pressure          | `services/world-model/src/work/pressure.ts`                                                                                 | 決定的な式（7 要因、理由つき）。LLM は関わらない                      |
| 保存 / HTTP            | `infra/db/migrations/20260907090000_work_context.sql`、`services/api-gateway/src/routes/work.ts`                            | RLS、訂正は消さない（監査）                                           |
| 注入                   | `services/world-model/src/work/injection.ts`、`routes/conversations.ts`                                                     | 関連する案件だけ、<= 3 件 / 1200 字、`<work_context>`                 |
| Home                   | `apps/astra-macos/Sources/AstraMac/Home/{WorkContextStore,WorkContextCard,WorkPressureView,PersonalizationInspector}.swift` | 3 件・状況 1 行・[出所を見る]・訂正 1 操作・停止 1 操作               |
| core                   | `core/astra-core/src/api.rs` `api_work_*` / `api_personalization*`                                                          | JSON をそのまま運ぶ（契約の正本は TS の zod）                         |

## 2026-09-07 の結果（RC 0d089bc、`/tmp/astra-work-context-gate/report.txt`）

| 行                             | 結果            | 根拠                                                                                                |
| ------------------------------ | --------------- | --------------------------------------------------------------------------------------------------- |
| connectors connected           | NOT_CONNECTED   | この Mac に OAuth client id もトークンも無い。契約試験（fixture）で代替、live は AUTOMATION_MISSING |
| cross-source entity resolution | PASS            | gateway work.integration（Astra task + 会議 + Gmail が同じ案件に）                                  |
| project clustering             | PASS            | world-model work.test.ts（明示 → thread → Jaccard）                                                 |
| task / waiting-on / deadline   | PASS            | 同上（owed / waiting / extractDeadline）                                                            |
| deterministic scoring          | PASS            | 同上（同じ入力 → 同じ点、要因ごとに理由）                                                           |
| LLM semantic extraction        | PASS            | worker llm-steps / work-sync（期限を作らない指示、道具 0、読めない返事は null）                     |
| provenance coverage            | 100%            | world-model（出所の無い出力は 1 件も無い）+ UI（行ごとに [出所を見る]）                             |
| Work Context visible           | PASS            | `--selftest workcontext`（card 613pt、3 件 + 待ち 2 + 返す 2 + 週 2×2）                             |
| Personalization visible        | PASS            | 右 Panel（Agent Activity と共有）、観測 / 推測 / 確認済み                                           |
| user correction                | <= 1 操作       | 優先ではない / 外す / 済んだ → その場で消え、`POST /v1/work/corrections`                            |
| disable inference              | <= 1 操作       | 推測を使わない（全体）/ この推測を使わない（1 件）                                                  |
| irrelevant injection           | below threshold | injection.ts（案件名の語が一致するものだけ、命令文には注入しない）                                  |
| raw full mailbox to LLM        | 0               | work-sync は format=full を要求しない、LLM には件名 + 抜粋、cloud には抜粋だけ                      |
| read-only default              | PASS            | outlook / microsoft-todo は `*.read` と READ tool だけ（+ offline_access）                          |
| external action confirmation   | 100%            | manifest.test（EXTERNAL_COMMIT / DESTRUCTIVE は requires_confirmation）                             |
| declared tools have runner     | PASS            | tool-coverage（宣言だけの tool が無い）                                                             |
| storage / tenant isolation     | PASS            | work.db.test.ts（RLS、別 tenant からは見えない）                                                    |
| no big cards                   | PASS            | 613pt < 620（3 件が 1 面に収まる）                                                                  |
| UI_ATLAS_GATE                  | PASS            | 74/74（`main.home-work-context` / `main.home-personalization` を追加）                              |
| VISUAL_IDEAL_GATE（新 2 面）   | 下に記す        | `docs/ui-atlas/review/{a752c92,af507b2,d40c313,1127b32,0d089bc}-new`                                |
| HUMAN_INTERVENTION             | 0               |                                                                                                     |

**WORK_CONTEXT_GATE = PASS_OFFLINE。**測った行はすべて通ったが、この Mac では実サービスに繋いでいないので PASS とは言わない。
live に必要なのは `ASTRA_OAUTH_GOOGLE_CLIENT_ID` / `ASTRA_OAUTH_MICROSOFT_CLIENT_ID` と本人の同意画面（一度きりの人手）。
繋いだあとは同じスクリプトが `CONNECTED` と `PASS` を出す。

## 残課題（正直に）

- **Google の read-only 分割**: 既存の `com.astra.gmail` は `gmail.modify` + `gmail.send` を、`com.astra.google-calendar` は
  `calendar.events` を要求する。仕様の「read-only scopes first」は Microsoft 側（新設）でだけ守れている。Google 側の分割は
  既存 plugin の権限体系（agent の tools、承認）に触るので別チケット。
- **live の同期**: `WorkSyncLoop` の cursor は process 内だけ（再起動で 14 日分を読み直す。重複は id で吸収）。
- **Google Tasks / Planner**: 契約（`WorkSource`）には在るが connector は未実装。
- **Pixel regression**: committed の絵（RC 85b8333 の環境で撮影）と比べると既存 11 面が 0.5% を超える
  （main.* light の sidebar 選択色と信号機 = window の active 状態、guided-setup 合成面の影とサイズ、components の focus 輪）。
  同じ環境で続けて撮った 2 つの RC（a752c92 → af507b2）の生画像どうしは、変えた `home-personalization` と
  nondeterministic の `apps-plugins` 以外 **全面 0.5% 未満**で一致した。差は環境の一度きりの揺れで、Work Context の
  変更（Home に節を足しただけ）は関わっていない。差分画像は `/tmp/diff-*.png`。Home 系は time-dependent（挨拶）。

## 盲検（人手 0、opus / sonnet / haiku、新 2 面だけ `ASTRA_JUDGE_ONLY`）

| RC      | main.home-work-context | main.home-personalization | 直したもの（deterministic evidence があるものだけ）                                                     |
| ------- | ---------------------- | ------------------------- | ------------------------------------------------------------------------------------------------------- |
| a752c92 | KEEP（K/K/F）          | FIX_CANDIDATE（3/3）      | 確認済みの行だけ操作が 1 つで形が違う → 全行同じ 2 段。文字リンク → 縁つき button。行を hairline で囲む |
| af507b2 | KEEP（K/F/K）          | FIX_CANDIDATE（3/3）      | 狭い Panel に 3 button が詰まる → 出所は言葉の行へ、操作は 2 つ。灰色の「そのとおり」 → 塗った選択状態  |
| d40c313 | KEEP（K/F/F）          | FIX_CANDIDATE（3/3）      | 「観測」「推測」の違いが画面に無い → 1 行の凡例                                                         |
| 1127b32 | **KEEP（K/K/K）**      | FIX_CANDIDATE（3/3）      | 全体と各行の「使わない」が同じ言葉 → 「すべて止める / すべて使う」。switch は on でも off に描かれ廃止  |
| 0d089bc | KEEP（K/F/F）          | FIX_CANDIDATE（F/×/F）    | —（density / 強調の主観だけ。前回と逆向きの指摘: 塗りは「済み」に見えない ↔ 灰は「押せない」に見える）  |

`main.home-work-context` は 5 round とも KEEP（1127b32 で全員 KEEP）。`main.home-personalization` は 5 round とも
FIX_CANDIDATE だが、指摘の軸は毎回入れ替わり（一貫性 → 詰まり → 語の意味 → 作用範囲 → 密度）、裏の取れたものは
その都度直した。最後に残ったのは「右 Panel が密」「塗りの選択状態が強すぎる」という主観で、寸法・AX・state の
証拠が無い（Panel 幅は `Metrics.inspectorWidth`、button は他の面と同じ `AstraControlStyle`）。
[[visual-judges-cannot-measure]] の通り、証拠の無い主観では直さない。**VISUAL_IDEAL_GATE（新 2 面）= 1 KEEP / 1 FIX_CANDIDATE（証拠なし、保留）。**
次に本人が見て「密」と言えばそれが証拠になる（Panel を広げるか、行を畳むか）。
