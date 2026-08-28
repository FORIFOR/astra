# Astra UI/UX テスト仕様書 v1.0

> **正本**。UI/UX の受け入れは「画面が表示できる」ではなく
> **ユーザーが迷わず一連の仕事を完了できるか**で判定する。

## 1. テスト目的

Astra が macOS / Windows 上で、次の一連の体験を自然に提供できることを確認する。

```text
Astra起動 → 上部Voice HUDが常駐 → どこでも音声入力 → 必要ならAstraへ質問
 → 会議開始 → Recording Workspaceへ切替 → 文字起こし/翻訳/AI要約/質問/RAG
 → 会議終了 → 履歴・Libraryへ保存 → 通常のVoice HUDへ復帰
```

### 評価軸

| 評価軸         | 内容                                                  |
| -------------- | ----------------------------------------------------- |
| Visual         | デザイン、位置、余白、フォント、Glass、アニメーション |
| Interaction    | クリック、Hover、Drag、Shortcut、Focus                |
| Flow           | 操作手順が自然か、迷わないか                          |
| Function       | 実際に録音・STT・Agent などが動くか                   |
| Reliability    | 切断・権限拒否・クラッシュから復旧できるか            |
| Cross-platform | macOS / Windows で同じ Astra 体験になっているか       |

---

## 2. 最重要 E2E シナリオ（Product Reality Gate）

### E2E-001 通常利用 → 会議 → 保存

**前提**: Astra 起動済み / マイク許可済み / Calendar 接続可能 / STT 利用可能

**操作**: 起動 → Voice HUD 確認 → テキスト欄へカーソル → Shortcut 長押し → 発話 →
テキスト入力 → 「会議を録音」 → Recording Workspace 表示 → 2人以上で発話 →
Transcript 確認 → AI 要約確認 → 質問 → RAG 資料追加 → Stop → 保存完了 →
Library から会議を開く → Transcript / Summary 確認 → Voice HUD へ戻る

**PASS 条件**

- ユーザーがモードを手動で何度も切り替えなくても完遂できる
- Voice HUD と Recording Workspace が**同時に残らない**
- 録音開始/停止が明確
- Transcript がリアルタイムに増える
- AI 回答が会議コンテキストを利用する
- 保存後に再アクセスできる
- **エラーが起きてもユーザーデータを失わない**

> これが通らない状態では、個別機能が完成していても「Astra 完成」と判定しない。

### 自動テスト（実装済み）

`--selftest e2e001 [gateway]` が E2E-001 を**窓を実提示したまま**一本で通す
（`scripts/verify-macos-recording.sh` 経由で `pnpm verify:all` に組込み済み）。

| 手順         | 5 系統       | 機械的な判定                                                             |
| ------------ | ------------ | ------------------------------------------------------------------------ |
| ① HUD 常駐   | —            | CGWindowList に HUD(310×31) が在り、Workspace(920×590) が無い            |
| ② dictation  | **ACT**      | 実 NSTextField へ `Dictation.insert` が入る（会話を始めない）            |
| ③ 会議開始   | —            | `toggleRecording()` **1 操作だけ**で Workspace が出て **HUD が消える**   |
| ④ 録音       | **HEAR**     | 実マイクで `recordedMs > 0`                                              |
| ⑤ Transcript | **HEAR**     | セグメントが増える                                                       |
| ⑥ Screenshot | **SEE**      | 実 PNG が保存される                                                      |
| ⑦ AI 要約    | **THINK**    | 実 Agent が transcript を文脈に応答（gateway 必要）                      |
| ⑧ 停止→復帰  | —            | **1 操作だけ**で Workspace が消えて **HUD が戻る**                       |
| ⑨ 保存       | **REMEMBER** | online: Library 取得・未送信なし / offline: ディスクに残り復旧候補に出る |

**HUD と Workspace が同時に残らない**ことは内部フラグではなく
**window server の実表示（CGWindowList）**で ③⑧ の両方で検査する。
モード切替は `toggleRecording()`（＝グローバルショートカット）だけで、手動の窓操作を挟まない。

**実測（2026-08-29, offline 経路）**:
`SELFTEST_OK e2e001(offline): ①HUD常駐 → ②dictation → ③Workspace(HUD退避・排他OK) →
④実録音5000ms → ⑤transcript+2 → ⑥screenshot → ⑦AI(gateway無しのため未実行) →
⑧保存→HUD復帰(排他OK) → ⑨オフライン保存・復旧候補あり`

gateway（Postgres+Redis+Temporal）が上がっている環境では ⑦AI と ⑨Library も実測される。
このオフライン経路は ERR-001「ネット切断でもローカル録音継続」/ ERR-006「次回起動で復旧候補」
の同時検証にもなっている。

---

## 3. Voice HUD

- **HUD-001 初期表示**: 画面上中央 / 他アプリ使用中も表示 / フルスクリーンでも仕様通り /
  フォーカスを奪わない / 背後のアプリ入力を妨害しない / 複数 Display で正しい Display に出る。
  Windows では Windows 用の実 Shortcut を表示する。
- **HUD-002 Listening**: 100〜200ms 程度で視覚フィードバック / Mic 入力に Waveform が反応 /
  Shortcut 解放で終了 / 誤って録音 Workspace へ入らない。
- **HUD-003 Processing**: 「認識されていない」のか「AI 処理中」なのかを区別できる。
- **HUD-004 TextField-aware dictation**: Slack/Safari/Notes 等の TextField にカーソルがあるとき、
  発話が**その入力欄へ入り**、Agent 会話を勝手に開始しない。

## 4. Recording Workspace

- **REC-001**: Voice HUD が fade out → Workspace が fade in。1 枚の Workspace /
  指定サイズ / Task Dock が上辺へ食い込む / 凹み形状に破綻なし / shadow・Material 正常。
- **REC-002 Task Dock**: `● 04:21 Pause Transcript Screenshot … Stop` が各々機能する。
- **REC-003 Recording Hero**: Mic 入力と waveform が一致 / Pause で状態が変わる /
  無音時も録音状態を明確に認識できる。

## 5. Transcript

- **TR-001 Realtime STT**: partial 表示 → final へ自然に置換 / 二重表示しない /
  Scroll が不自然にジャンプしない / 読んでいる最中に勝手に最下部へ戻しすぎない。
- **TR-002 Speaker separation**: 最低 `You` / `Remote`。可能なら `Speaker 1/2` へ拡張。
- **TR-003 Translation**: 原文が消えない / ON/OFF 可能 / 言語混在で UI が壊れない。

## 6. AI 機能（Workspace に最低 4 つ）

- **AI-001 Realtime Summary**: 会議全体を考慮 / 毎発話で全文がチラつかない /
  新情報だけ更新 / **聞いていない内容を捏造しない**。
- **AI-002 Ask Astra**: 会議内に答えがあれば答える。無ければ「会議内では確認できません」。
- **AI-003 Decisions**: 要約と Decision を**分ける**。
- **AI-004 Actions**: 担当/期限が会話に無ければ**勝手に作らない**。

## 7. RAG UI

- **RAG-001 Drawer**: Workspace 外へはみ出さない / 追加元が分かる /
  何を AI へ渡しているか分かる / Source を削除できる。
- **RAG-002 Source transparency**: 回答に根拠（どのファイル・どの会議）を表示。
  **「AI が何を見ているか」**を UX 原則にする。

## 8. Screenshot → AI

- **SCR-001 Capture**: 撮影後にユーザーが改めてアップロード不要 /
  現在のアプリ・Window コンテキストと結びつく / Astra 自身の Overlay を極力 capture しない。

## 9. Main Window

トップレベルは `Home / AI Agents / Library / Apps` に固定。

- **MAIN-001 Home**: Ask Astra / Recent / Upcoming meeting / Tasks / Recent captures
- **MAIN-002 Agents**: Agent ごとに 使用可能 Apps / 権限 / 最近の実行
- **MAIN-003 Library**: Meetings / Transcripts / Screenshots / Files / AI outputs を横断検索

## 10. Apps / Connectors

- **APP-001**: Connector 一覧と接続状態
- **APP-002**: `Disconnected / Authorizing / Connected / Permission Required / Error` を区別
- **APP-003**: 能力（権限）単位で可否を見せる

## 11. Agent UX

- **AGENT-001 Read**: 検索・要約は確認なし
- **AGENT-002 Write**: 送信・削除・作成・編集・購入は**必ず確認**（宛先と本文を見せる）

## 12. Calendar / Meeting detection

- **MEET-001 Upcoming**: 直近予定と「録音を開始」
- **MEET-002 Detection**: Zoom/Teams/Meet を検出し**提案**する。**勝手に録音開始しない**。

## 13. 保存・履歴

- **SAVE-001 Stop**: 保存中 → 保存完了 → Workspace close → Voice HUD 復帰
- **SAVE-002 Meeting Detail**: Title/Date/Participants/Summary/Decisions/Actions/
  Transcript/Recording/Attached context

## 14. エラー / 復旧（必須）

| Test    | 発生条件          | PASS               |
| ------- | ----------------- | ------------------ |
| ERR-001 | ネット切断        | ローカル録音継続   |
| ERR-002 | STT 切断          | 自動再接続         |
| ERR-003 | Mic 切断          | 明確な警告         |
| ERR-004 | System audio 停止 | 状態表示           |
| ERR-005 | AI API 失敗       | 録音自体は失わない |
| ERR-006 | App crash         | 次回起動で復旧候補 |
| ERR-007 | Permission denied | 設定導線表示       |
| ERR-008 | Disk 不足         | 録音前/中に警告    |

> **AI が失敗しても録音そのものを壊さない**ことが重要。

## 15. Visual Regression

Design Token を単一の正とし数値化する。

```text
Window size ±1pt / Task Dock position ±1pt / Notch geometry ±1pt
Card padding ±1pt / Palette position ±2pt
```

corner radius / border / shadow / material / font / weight / line height /
icon size / opacity をチェック。macOS・Windows は**別々の Golden Screenshot**を持ち、
Material やフォントレンダリングまで OS 間で同一 pixel を要求しない。

## 16. Interaction 品質

`Normal / Hover / Pressed / Focused / Disabled / Loading / Error / Drag / Keyboard navigation`。
小さいアイコンは見た目 12px でも **hit area は 28〜32pt** 確保。

## 17. Accessibility

screen reader / accessibility label / キーボードのみ操作 / Tab order / Focus ring /
文字サイズ / コントラスト / **色だけで状態を示さない**（`● 録音中` のように文字でも示す）。

## 18. Performance UX 目標

| 操作                     |     UX 目標 |
| ------------------------ | ----------: |
| Voice HUD 反応           |     < 200ms |
| Recording Workspace 表示 |     < 300ms |
| 録音開始                 |     < 500ms |
| STT partial 表示         | P95 < 約1秒 |
| UI interaction           |       60fps |
| RAG Drawer               |     約180ms |
| AI 処理開始表示          |     < 200ms |

AI 回答自体が数秒かかっても `Thinking… / Searching Gmail… / Reading 3 files…` のように
**何をしているか即表示**する。

---

## 19. 実装優先度

### P0 — Astra v1 の最低ライン

1. Voice OS 型 Top HUD（global voice / dictation / listening・processing state）
2. 全アプリ音声入力（focused text field へ入力）
3. Recording Workspace（Task Dock / Mic・System Audio / Pause・Stop / Transcript）
4. リアルタイム STT（You・Remote / partial・final）
5. AI Meeting（Summary / Ask / Decisions / Actions）
6. 保存・Library（Meeting 履歴 / Transcript / Summary）
7. Apps（Calendar / Finder / Gmail 程度から）
8. RAG（File / Previous meeting）
9. 失敗耐性（Offline local recording / recovery）

### P1 — 差別化

Screenshot → AI / Screen Context / Context-aware Voice Routing /
Meeting detection / Translation / Connector permissions / Agent confirmation

### P2 — AI OS 化

Cross-meeting RAG / Long-term memory / Agent workflows / Screenshot history /
App context memory / MCP / Custom Agents / Plugin marketplace / Workflow automation /
Local AI / Cloud AI / Proactive suggestions

---

## 20. Product Done 判定

機能数ではなく、次の 5 系統が**実機 E2E で一本につながっているか**で判定する。

```text
SEE      画面が分かる
HEAR     音声が分かる
THINK    コンテキストを理解する
ACT      アプリを操作できる
REMEMBER 保存して再利用できる
```

特に **①音声 + ②画面 + ③会議 + ⑤操作** が 1 つの Context Engine でつながることが Astra の本質。
