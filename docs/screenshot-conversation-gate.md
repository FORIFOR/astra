# SCREENSHOT_CONVERSATION_GATE（2026-09-07）

「⌘⇧4 → 『これ何？』」を完成機能として Freeze するための gate。人はクリックも判定もしない
（HUMAN_INTERVENTION = 0）。測定器は 4 本:

| 測定器                                     | 何を測るか                                                                         |
| ------------------------------------------ | ---------------------------------------------------------------------------------- |
| `AstraMac --selftest screenshotcontext`    | 検知・分類・会話紐付け・参照解決・キャッシュの規律・path traversal                 |
| `AstraMac --selftest screenshotegress`     | 画像の行き先（SCREENSHOT_EGRESS_TRUTH）                                            |
| `scripts/reality/run-screenshot-e2e.sh`    | 実 gateway + 実 task worker + 実 agent-host + 実 Claude Code CLI + 実 PNG（nonce） |
| `scripts/reality/run-unattended-verify.sh` | TCC を含む verify-all の無人実行（**AUTOMATION_MISSING**、測定器を作る）           |

## 2026-09-07 の結果（rc/atlas-61）

| 行                          | 結果           | 根拠                                                                                |
| --------------------------- | -------------- | ----------------------------------------------------------------------------------- |
| detect standard screenshot  | PASS           | screenshotcontext（監視経路 53ms）                                                  |
| detection latency           | <300ms         | 53ms（DispatchSource → 安定 → 完成判定 → 登録）                                     |
| clipboard screenshot        | PASS           | screenshotcontext 6)                                                                |
| partial ingestion           | 0              | IEND/FFD9 + ImageIO statusComplete、監視経路で半分書き→完成で 1 回                  |
| duplicate ingestion         | 0              | path#size 鍵                                                                        |
| latest 「これ」             | PASS           | resolver                                                                            |
| previous 「さっきの」       | PASS           | 2 枚以上で 1 つ前、1 枚ならそれ                                                     |
| recent pair comparison      | PASS           | 「さっきのと今の」「この 2 枚」「この 3 枚」                                        |
| question-before-attach      | 0              | attach は参照表現の質問でだけ（attachCount）                                        |
| capture-only egress         | 0              | screenshotegress                                                                    |
| gateway pixel egress        | 0              | `turn_body` 検査 + contracts strict（data 付き添付は 400）                          |
| provider egress truth       | PASS           | `VisualEgressPolicy` + Facts の開示文。「出ない」とは言わない                       |
| actual gateway              | PASS           | run-screenshot-e2e.sh（202 → task）                                                 |
| actual worker               | PASS           | agent-host が claude_code で online、llm.answer を実行                              |
| actual CLI reads real PNG   | PASS           | Read を許し、画像の中の文字を返した                                                 |
| image-only nonce answered   | PASS           | 質問「この画像のエラーコードは？」→ 答え `VX-7D5253`（16 秒）                       |
| cross-conversation leakage  | 0              | 会話が変わると写しを消し、別会話の artifact は添えない                              |
| path traversal              | 0              | app: `canonicalHandoverURL`、worker: `canonicalImagePath`（symlink 脱出も無い扱い） |
| expired attachment readable | 0              | TTL 30 分で写しを消す（purge / 起動時掃除）                                         |
| focus theft                 | 0              | keyWindow / isActive 不変                                                           |
| extra window                | 0              | NSApp.windows 不変                                                                  |
| manual attach               | 0              | 体験は「撮る → 尋ねる」                                                             |
| manual save/search          | 0              | 同上                                                                                |
| HUMAN_INTERVENTION          | 0（この gate） | verify-all（TCC）の無人実行だけが AUTOMATION_MISSING                                |

E2E の実行で見つけて直したもの: General Assistant は workflow を持たず「宣言順に全部」（answer → compose）が走り、
質問の答えが compose の下書き（「※ 下書きです」）に**上書き**されていた。`workflows/assistant.json` で
「問いには answer だけ / instruction には compose だけ」を宣言し、registry が `applies: true` 固定にしていた
条件を planner で実際に評価するようにした（宣言だけで効いていない型）。

## 残り

- `run-unattended-verify.sh`: 専用の macOS テストアカウント → `tccutil reset` → 署名 RC を `open` で起動 →
  AX / CGEvent で操作 → artifacts。**「本人の VERIFY_ALL_OK 待ち」を恒久条件にしない。**
