# Release Reality 実行監査 — 2026-09-07

**RELEASE = NO-GO / Work Context Release Freeze 未達。**
FAIL・NOT_MEASURED・AUTOMATION_MISSING のいずれかが残れば GO にしない。
Offline の成功や資格情報の存在を Live の成功に読み替えない。

## 対象

- 実装は `main` ではなく `.claude/worktrees/ui-atlas-review`、ブランチ `rc/atlas-61`。
- HEAD: `8b6bdf771888a0e5b12834065b742569e9ef2c31`。
- 作業開始時点から `workers/agent-host/src/work-sync.ts` に未コミット変更あり。既存変更を保持し、欠けていたbackoffメソッドと回帰試験を追加した。
- 保存済み `apps/astra-macos/.build/Astra.app` の実行体 SHA-256:
  `26c7407013bf255b4544371f9ee93243b5696acd35ebedd21536f524df327cc7`。
- `codesign --verify --deep --strict` は終了0。ただし **Apple Development 署名**。
- `xcrun stapler validate` は終了65、ticket なし。
- `gh run list --commit <上記HEAD> --json ...` は空配列。対象SHAのCI成功は確認できない。
- この監査の `verify-all` はソース検証であり、上記バンドルを使用した exact-artifact 検証ではない。

## 実行結果と不足

| 必須Gate | 状態 | 証拠・未達事項 |
| --- | --- | --- |
| GOOGLE_DAILY_WORK_LIVE | AUTOMATION_MISSING | 実行終了3。`ASTRA_TEST_GOOGLE_CLIENT_ID` / `ASTRA_TEST_GOOGLE_REFRESH_TOKEN` 未設定 |
| MICROSOFT_DAILY_WORK_LIVE | AUTOMATION_MISSING | 実行終了3。`ASTRA_TEST_MS_CLIENT_ID` / `ASTRA_TEST_MS_REFRESH_TOKEN` および MICROSOFT 別名も未設定 |
| LIVE_CONNECTOR_RECOVERY_GATE | AUTOMATION_MISSING | 指定マトリクスのLive測定器なし。送信timeout後の二重送信0は未証明 |
| DAILY_USER_JOURNEY_LIVE | AUTOMATION_MISSING | 既存live-assertはHome・返信・Brief。6問すべてのLive回答、1操作の出所到達を検証していない |
| PERSONALIZATION_REALITY_GATE | AUTOMATION_MISSING | 訂正直後・個別無効化・全OFF・無関係なSwift依頼への注入0をLiveで未検証 |
| Invocation / Voice | NOT_MEASURED | 今回指定の全閾値を同じRCで未測定。既存selftestの成功を実音声の先頭欠落0と同一視しない |
| Real Meeting → Work Graph → Brief | AUTOMATION_MISSING | `ASTRA_MEET_URL` / bot profile 未設定。BlackHoleは存在。bundleのDB試験は実Meet経路の代替ではない |
| Screenshot | NOT_MEASURED | 最終RCでのnonce・latency・egress・参照解決の再測定未実施 |
| Live TCC / Guided Setup | AUTOMATION_MISSING | 専用macOSユーザー `astra-verify` なし。現スクリプトはgrant recovery未実装、全5権限を完走しない |
| Keyboard / VoiceOver | AUTOMATION_MISSING | 現FKAは3面のTab移動。VOは項目巡回のみでC/Dもidle面。指定4journeyの結果到達をassertしていない |
| Six Principles / Visual final | NOT_MEASURED | 同一RCの全必須証拠を今回取得していない。旧goldenやKEEPを自動継承しない |
| Release Artifact | FAIL | 開発署名、stapleなし、CI未確認、dirty tree。Sparkle実更新・exact RC guide・配布物との一致も未測定 |

Google/Microsoft共通のpreflightで `postgres:5433`・`dbmate`・`claude code cli` は検出できた。
資格情報はチャットや証跡へ貼らず、専用identityの実行環境へ設定する。
トークンのprovisioningだけでは以下の測定器の欠落は解消しない。

## Live測定器で先に直す必要がある箇所

1. `workers/agent-host/src/live-seed.ts` は広いscopeで得た同じaccess tokenを、読む接続・書く接続へ最初から保存する。
   `grantedScopes` のラベルをread-onlyにしても実tokenの権限は減らない。JIT write permissionの実測にならない。
2. `live-assert.ts` の `sinkReceived` はGoogleのSENTラベル、Microsoftの件名前方一致で成功する。
   期待した本文・宛先・thread・送信件数1・受信側到達を検証していない。
3. approvalを探して承認するが、未承認中のprovider副作用0や「承認を実際に取得した」の必須assertがない。
4. 会議は `syntheticMeetingArtifacts` を直接POSTする。202だけでdecision/action行をPASSにし、
   実Meetのfinalize経路も重複件数もここでは検証していない。
5. cleanupは失敗を握りつぶし、seedの完了前に失敗すると作成済みIDが保存されない。
   送信済み返信の掃除も対象外。最終PASSはcleanup検証後に出す必要がある。
6. `services/task/src/workflows.ts` はtool activityを最大5回再試行する。
   `activities.ts` はexecutor失敗で代替経路を試し、`StepEscalated` を再試行可能として投げる。
   送信受付後に応答だけ失われたケースの副作用照合・再送抑止を実環境で証明する必要がある（P0）。
7. `routes/work.ts` の返信idempotency keyは宛先/provider/本文内容を含まず本文の長さだけを見る。
   これはprovider側送信のat-most-once保証ではなく、同じ長さの別本文を衝突させる可能性もある。

上記はコードから確認した不足・リスクであり、実サービスで二重送信が発生したという測定結果ではない。

## 今回のP0対策と回帰結果

- 外部 write / commit はTemporal activityを最大1回にし、activity内でも代替connector・browser・screenへ降りない。
  応答喪失後は `ExternalActionFailed`（non-retryable）として止め、再実行前に実行先履歴を確認する。
- 返信APIの冪等キーを `user + canonical payload` に変更した。同じ要求の再送は同じtask、本文・宛先・provider・threadの変更は別taskになる。
- 実DB + Temporalの障害注入試験（Google相当 / Outlook相当）で、承認前の受付0、承認後の受付1、fallback 0、task FAILEDを確認した。
  `task-p0-final.log`: 5 files / 55 tests passed。これはprovider APIを呼ばない最小範囲の暫定テストで、Live GateのPASSではない。
- gatewayの実DB統合試験: 16 files / 170 passed / 1 skipped。`tsc -b services/task services/api-gateway`、`git diff --check`、対象gateの `bash -n` は成功。

## この監査で修正した集計不具合

- `run-meeting-work-loop-gate.sh`、`run-daily-work-gate.sh`、`run-reply-brief-gate.sh`:
  `$(ok ...)` 内の `fail=1` はsubshellだけを変更していた。全コマンドの終了状態を親で集計する。
  表のFAILや空欄も親の `row` で失敗として扱う。
- DAILY_WORKはcredentialが存在するだけでPASSへ昇格させず、実行内容に合わせてPASS_OFFLINEとする。
- `verify-all.sh`: Swift testの終了状態を保存して返す。要約用grep/headの成功でテスト失敗を隠さない。

検証ログは `/tmp/astra-reality-audit/`。DB停止の再現にモックサーバーは使っていない。

- `meeting-db-unavailable.log`: 実TCP接続先 `127.0.0.1:1` が接続拒否。必須DB試験の失敗を最終FAIL・終了1へ伝達。
- `meeting-db-available.log`: 実PostgreSQLの一時DBによる既存bundle試験は成功・終了0。
  この結果はOffline回帰検証でありReal Meeting GateのPASSではない。
- `google.log` / `microsoft.log`: 両providerのpreflightは終了3、AUTOMATION_MISSING。
- `verify-all.log`: 最終結果 **VERIFY_ALL_FAIL、終了1**。UI taste、permission JIT、窓生成、guide撮影、
  conventions（同梱plugin期待12に対して14）、録音などで失敗を観測。
  gateの上限変更やNOT_MEASUREDの除外で緑にしない。
- Swift unit testsは終了0。`bash -n` と `git diff --check` も終了0。
- 全体検証後も保存済み署名バンドルの実行体hashは上記と一致した。

新機能追加・commit・公証・配布は実施していない。次のRCを確定する前に、上記の失敗と測定器不足を解消し、
Google → Microsoft → recovery → Real Meet → TCC → keyboard/VO → exact RC の順で証拠を取り直す。

## 2026-09-08 GitHub反映時の追記

ユーザー指示により、修正と監査資料を rc/atlas-61 にコミットしてpushする。main の未pushコミットも別途pushする。Release判定はNO-GOのまま。

- Agent Host: 9 files / 100 tests passed。
- 録音のprocess跨ぎ復旧、guide、合成Journey JA/JB/JC、light/dark golden・geometry・session撮影は個別成功を確認。
- 最新の全体集計は VERIFY_ALL_FAIL。個別成功を全体合格へ読み替えない。
- 合成E2EはASTRA_E2E_SYNTHETICを使用。実マイク・実STTの証拠ではない。
- UI taste上限緩和は裏づけのある実画面レビュー記録がないため撤回した。
- Google/Microsoft live identity、live測定器の不足、公証・staple等の未達は上記のまま残る。
- GitHubへのコード保存はRelease=GOや配布の承認を意味しない。

## 2026-09-08 配布アーティファクト再検証

配布スクリプトのCPU別ビルド出力、ライブゲートのcleanup、確認ゲートの終了状態を修正した後、同じRCから配布物を作り直した。

- `dist/Astra.app` は Developer ID Application（Shuhei Horio）で署名し、hardened runtime と deep strict 検証に成功。
- 公証 submission `2badcbd5-2e70-4f15-bc95-9adb09bd9af8` は Apple の `Accepted`。staple と `xcrun stapler validate` に成功。
- `spctl --assess --type execute --verbose=4 dist/Astra.app` は `accepted` / `source=Notarized Developer ID`。
- `scripts/verify-release-artifact.sh` は初回起動、DB生成、録音の強制終了後復旧、inspect、resume、finish、ready残存まで成功。
- 配布ZIP SHA-256: `adbfee872513810ad298198f83cbc0236503734db29e688c5c76d4bbaaec10a1`。
- この結果により Release Artifact gate は PASS へ更新できる。ただし Google/Microsoft の実OAuth、Real Meeting、TCC専用ユーザー、Keyboard/VoiceOver、全Live Work Context閉ループは未測定または `AUTOMATION_MISSING` のままであり、総合判定は **RELEASE = NO-GO**。
- `run-work-context-release-gate.sh` は同じRCで Offline 全項目 `PASS`。Live は両providerとも `AUTOMATION_MISSING`。
- `run-real-meeting.sh dist/Astra.app` は BlackHole + `SwitchAudioSource` の実マイク経路で transcript similarity 0.90、decision 2/2、action 1/1、pause leakage 0、Library ready、source jump 0件を確認した（`REAL_MEETING_GATE=PARTIAL`）。`ASTRA_MEET_URL` / bot profile が無いため、実MeetのPASSには昇格しない。
- `verify-macos-recording.sh` は合成ディスク録音・復旧などを通過したが、E2E-001実キャプチャは終了134（TCC/実環境の未解決）であり、合成結果へ読み替えない。
