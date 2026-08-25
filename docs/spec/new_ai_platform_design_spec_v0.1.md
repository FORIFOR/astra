# 新AIプラットフォーム 詳細設計仕様書 v0.1

> 目的: DeepNoteで培った音声・会議・AIエージェント・共有・ローカル実行の技術を再利用しつつ、サービス名・情報設計・バックエンドをゼロベースで再設計する。  
> 製品定義: **VoiceOSの“OS全体から話して動かす”体験 + Super Internの“会話の中にAI機能を埋め込む”体験 + JARVIS的Universal Interface + Deep Research + 専業AIエージェントプラットフォーム**。

---

## 0. Executive Summary

新サービスは「AIチャット」「音声入力」「会議議事録」「AIエージェント」「プラグインストア」を別製品として見せない。
ユーザーに見せるトップレベルUIは次の4タブだけとする。

1. **ホーム** — 今日・今・自分に必要なことを一画面で把握し、何でも頼める入口
2. **AIエージェント** — 実行中/完了タスク、汎用エージェント、導入済み専業エージェントと各ダッシュボード
3. **ライブラリ** — Task Dock・会議・Research・各Agentが作った成果物、議事録、録音、画像、動画、レポートの統合保管庫
4. **プラグイン** — 連携・専業AIエージェント・スキル・ダッシュボードを追加/更新するストア

加えて、アプリ本体の外にも常駐する **Task Dock** をUniversal Interfaceとして提供する。
Task Dockは「チャットモード」「音声モード」「Researchモード」などをユーザーに選ばせない。
話す・打つ・画面を指す・ファイルを置く、のどの入口からでも同じConversation Engineへ入り、内部で最適なLaneへ自動ルーティングする。

製品のNorth Starは **Intent → Done** とする。

- 「調べて」→ Web/社内情報を検索し、根拠付きレポートを作ってLibraryへ保存
- 「会議始める」→ 話者分離リアルタイム文字起こし + 翻訳 + 会議後の確定議事録 + ToDo
- 「これ送って」→ 文脈理解 → 下書き → 必要なら確認 → 実行 → receipt
- 「この画像直して」→ 画像AI Agentへ委譲
- 「営業状況見せて」→ CRM Agentの専用Dashboardを表示

### 絶対に守る設計原則

- トップレベルNavigationは4タブから増やさない
- 「どのAI/ツールを使うか」を原則ユーザーに選ばせない
- VoiceとTextは同じ会話で自由に行き来できる
- 簡単な依頼のために巨大な画面を開かせない
- ユーザーが既に伝えたことを聞き直さない
- Researchは必ずEvidenceを残す
- 外部送信/変更/削除/高リスク操作は明確なpolicyを通す
- OS操作・秘密・ローカルファイルはLocal Control Plane優先
- 長時間処理は再開可能、重複実行しない、途中経過が見える
- Plugin追加でCore UIを破壊しない

---

# 1. 競合から採用する要素

## 1.1 VoiceOSから採用

VoiceOSの現在の強みは、単なる音声入力ではなく、Mac/Windows全体にまたがる常駐レイヤー、Integration Store、MCP拡張、画面理解、実行前確認にある。

採用するUX:

- system-wide shortcut / push-to-talk
- 入力中アプリを切り替えずに使えるfloating surface
- screen / pointer / selected textを文脈にできる
- integrationごとに「できること」を明示
- write/send/delete系を“asks first”として可視化
- 一クリック接続
- plugin/integrationの継続アップデート

採用しない点:

- Agent Mode / Dictation Mode等を前面に出してユーザーに切り替えさせる
- 連携単位で会話体験が分断されること

本サービスではモードを内部Routerへ隠す。

## 1.2 Super Internから採用

Super Internの重要な考え方は「新しい作業場所を増やさない」「会話そのものをAIの配布面にする」こと。
また、Modeを **Project Data + Prompt + Tools** の組み合わせとして扱い、ModeをPackage化して使い回せる。

採用するUX/設計:

- 会話の中でAIが働く
- 専門機能は“アプリを開く”ではなく会話から呼び出せる
- Agent PackをData + Prompt + Tools + UIとして配布
- ユーザーの編集/承認から好みを学習
- recurring task / daily brief / proactive heartbeat
- knowledge baseを継続同期
- 専門領域ごとのPackageをinstall可能

本サービスではSuper InternのMode概念を拡張し、**Agent Package** とする。

---

# 2. 製品情報設計 — 4タブ固定

## 2.1 Home Tab

### 役割

「今、何をすべきか」「何が進んでいるか」「何でも頼む」を1画面に集約する。
Homeはダッシュボードではなく **AIとの生活/仕事の入口**。

### レイアウト

```text
┌──────────────────────────────────────────────────────┐
│ Good morning                              [Avatar]   │
│                                                      │
│        ┌──────────────────────────────┐              │
│        │  何でもどうぞ            🎙 │              │
│        └──────────────────────────────┘              │
│                                                      │
│ NOW                                                  │
│ ┌ Meeting in 18m ──────────────── [準備する] ┐       │
│ ├ Research completed ───────────── [見る]     ┤       │
│ └ Reply promised today ──────────── [返す]     ┘       │
│                                                      │
│ RECENT                                               │
│  会議議事録 / 調査レポート / 生成資料 / Agent Run    │
└──────────────────────────────────────────────────────┘
```

### Homeに置くもの

- Universal Composer（Text + Mic + Attach）
- Now / Attention cards
- 次の会議
- 未完了commitment
- 実行中Agent Run
- 完了したResearch/生成物
- 最近のLibrary artifact
- AIからの提案（最大3件）

### Homeに置かないもの

- 全機能一覧
- Pluginの細かい設定
- 詳細分析Dashboard
- 大量のKPI
- サイドバーに10個以上の機能

### Proactive card出現条件

AIが勝手に話しかけすぎないよう以下のスコアで制御する。

```text
ProactiveScore = Importance × Urgency × Confidence × UserRelevance - InterruptionCost
```

表示条件例:

- 明確な期限/予定がある
- ユーザーのcommitmentが未完了
- 会議前に重要な変更が届いた
- 長時間Agentが完了した
- リスク/失敗が発生した

---

## 2.2 AI Agent Tab

### 役割

全Agentを「会話」「実行」「専用Dashboard」の3レイヤーで管理する。
トップレベルの新タブを増やさず、導入済みAgentはこのタブ内に増える。

### 画面構造

```text
AI AGENTS

[General] [Research] [Image] [Video] [CRM] [Care] [...]  ← subnav

┌ Agent conversation / command ───────────────────────┐
│ 「今月の失注理由を整理して」                         │
│                                                     │
│ Agent: 分析中…  8/12 sources                       │
└─────────────────────────────────────────────────────┘

┌ Dynamic Dashboard ──────────────────────────────────┐
│ KPI / Tables / Charts / Entity detail / Actions     │
└─────────────────────────────────────────────────────┘

┌ Runs ───────────────────────────────────────────────┐
│ running / waiting approval / complete / failed      │
└─────────────────────────────────────────────────────┘
```

### Core Agents（初期搭載）

- General Assistant
- Research Agent
- Meeting Agent
- Document Agent
- File/Workspace Agent

### Pluginで追加されるAgent例

- Image Generation/Edit Agent
- Video Generation/Edit Agent
- Sales CRM Agent
- Care Support Agent
- Electronic Medical Record Agent
- Architecture Agent
- Stock Research/Trading Agent

### Agent Tabの重要ルール

- Agentを切り替えてもConversation contextは必要範囲で継承
- 専門Agentをユーザーが明示しなくてもRouterが自動委譲可能
- 専用DashboardはPlugin manifestから生成
- Dashboardを開かず、Task Dockから直接Agentへ依頼できる

---

## 2.3 Library Tab

### 役割

全AI成果物の正本。
ユーザーが「どこに保存された？」と探さなくてよいようにする。

### 対象

- 会議録音
- リアルタイムTranscript
- 確定Transcript
- 議事録
- Meeting summary / decisions / action items
- Research reports
- Evidence bundles
- 生成ドキュメント
- スライド/PDF/表計算
- 画像
- 動画
- Code artifacts
- Agent generated exports
- CRM reports
- domain-agent outputs

### 情報モデル

Artifactは必ず以下を持つ。

```ts
Artifact {
  id
  tenantId
  ownerId
  type
  title
  mimeType
  sourceAgentId?
  sourceTaskId?
  sourceMeetingId?
  parentArtifactId?
  version
  objectKey
  size
  sha256
  createdAt
  updatedAt
  tags[]
  entities[]
  lineage[]
  sensitivity
  searchableTextRef?
}
```

### Library UX

- default = 最近使ったもの
- type chips: Meeting / Report / Document / Image / Video / Other
- semantic search + keyword search
- project/person/date filter
- generated-by Agent filter
- lineage表示
- version履歴
- preview
- share

### Share機能

すべてのArtifactにShareを提供。ただし“公開状態”はデフォルトOFF。

Share policy:

- random 256-bit share token
- optional password
- passwordはArgon2id hash
- expiry: 1h / 1d / 7d / 30d / custom
- revoke anytime
- view-only / download allowed
- optional one-time link
- optional email/domain allowlist
- optional watermark
- access audit
- brute-force rate limit
- raw storage URLを外部へ出さない

Share URLは公開viewer serviceが署名済み短期object URLを都度発行する。

---

## 2.4 Plugin Tab

### 役割

Integration Store + Agent Store + Skill Store + Dashboard Extension Store。
ユーザーにとっては「できることを増やす場所」。

### Plugin種別

1. **Connector Plugin**
   - Gmail / Outlook / Calendar / Slack / Drive / Finder / Notion / Jira等

2. **Capability Plugin**
   - image generation
   - video generation
   - web browser
   - code execution
   - OCR
   - data analysis

3. **Domain Agent Plugin**
   - CRM
   - Care
   - EHR
   - Architecture
   - Stock

4. **Skill Pack**
   - prompt + workflow + examples + policies

5. **Dashboard Extension**
   - domain-specific UI schema

### Plugin detail page

必ず以下を表示する。

- publisher / verified status
- version / updated date
- permissions
- data accessed
- tools count
- actions that require confirmation
- local/cloud execution surface
- pricing/usage if applicable
- Agent/dashboard screenshots
- changelog
- uninstall impact

### Plugin Package manifest

```yaml
id: com.example.crm-agent
version: 1.4.0
publisher: example
min_core_version: 2.0.0
category: domain-agent
execution_surfaces: [cloud, local]
permissions:
  - contacts.read
  - email.read
  - crm.write
connectors:
  - salesforce
  - gmail
agents:
  - id: crm-analyst
    skill: skills/crm-analyst.md
    tools: [crm.search, crm.update, mail.search]
dashboards:
  - id: pipeline
    schema: dashboards/pipeline.json
policies:
  - policies/crm-risk.yaml
data_extensions:
  - schemas/opportunity.json
signature: ...
```

### 更新

- semver
- signed package
- staged rollout
- compatibility check
- rollback
- critical security update channel
- migration scriptsはsandbox実行

---

# 3. 初期セットアップ — “何を追加するか”をユーザーに選ばせる

VoiceOS型のIntegration導入の分かりやすさと、Super Intern型のPackage選択を統合する。

## Step 1 — Promise

画面には説明を並べず1文。

> 「話すか、打つだけ。調べる・作る・動かすまでやります。」

[始める]

## Step 2 — Input Preference

- 音声中心
- テキスト中心
- 両方

選んでも機能制限はしない。初期UXだけ変える。

## Step 3 — “何を任せたい？”

複数選択:

- 会議
- 検索/調査
- メール/予定
- ファイル整理
- 営業
- 開発
- 画像/動画
- 介護
- 医療
- 建築
- 投資/市場調査
- その他

## Step 4 — Recommended Packs

選択に応じてBase + Pluginを推薦する。

例:

```text
営業を選択
→ Gmail
→ Google Calendar
→ Google Drive
→ Sales CRM Agent
→ Meeting Agent
```

一括Install可能だが、各権限は明示。

## Step 5 — OS Permission

一度に全permissionを要求しない。
利用目的の直前に説明してrequestする。

- microphone
- accessibility
- screen recording
- notifications
- files/folders
- calendar/contacts

## Step 6 — Voice Shortcut

- press/hold shortcut
- floating dock
- text shortcut

## Step 7 — First Magic Moment

> 「今、面倒なことを1つ頼んでください」

Safeなread/research taskを実際に完了させる。
チュートリアル動画より、1回の成功体験を優先する。

---

# 4. Task Dock — JARVIS Universal Interface

Task Dockは本製品の最重要UI。
通常のwindowではなく、OSのどこからでも出せる“薄い層”。

## 4.1 Input

- global shortcut tap → Composer
- global shortcut hold → Push-to-talk
- mic button → continuous conversation
- type anytime
- paste image/file
- drag file
- selected text
- screen region/pointer context

Voice/Textは同一Conversation。

## 4.2 States

```text
HIDDEN
  ↓
READY
  ↓
LISTENING
  ↓
UNDERSTANDING
  ↓
THINKING / RESEARCHING / ACTING
  ↓
WAITING_APPROVAL
  ↓
RESULT
  ↓
MINIMIZED TASK
```

## 4.3 Visual language

JARVIS感を出すが、SF UIをやり過ぎない。

- READY: thin translucent capsule
- LISTENING: small waveform + live transcript
- THINKING: subtle radial pulse
- ACTION: step progress
- APPROVAL: clear card
- DONE: compact receipt
- ERROR: reason + retry/alternative

### 重要

“AIが何をしているか分からない時間”を作らない。
2秒を超える処理はprogress eventを出す。

## 4.4 Progressive Surface

```text
Invisible
→ Capsule
→ Card
→ Side panel
→ Full workspace
```

簡単な返事のためにfull appへ遷移しない。
Research reportや専門Dashboardが必要な時だけexpandする。

---

# 5. Universal Interface → 6 Engine Architecture

```text
Universal Interface
        ↓
Context Engine
        ↓
Conversation Engine
        ↓
┌───────────────┬───────────────┐
│ Research      │ Action        │
│ Engine        │ Engine        │
└───────────────┴───────────────┘
        ↓
World Model
```

実際にはRouter/Task Runtimeを横断層として置く。

---

# 6. Context Engine

## 6.1 目的

ユーザーに説明し直させない。

## 6.2 Input sources

Local context:

- foreground app
- window title
- focused UI element
- selected text
- current URL
- cursor/pointed region
- recent files
- clipboard（opt-in）
- microphone state
- local indexed files

Connected context:

- calendar
- email
- contacts
- drive
- slack
- notion
- plugins

Conversation context:

- recent turns
- active entities
- unresolved references
- task state
- research session
- meeting state

World context:

- people
- organizations
- projects
- decisions
- commitments
- tasks
- artifacts
- preferences

## 6.3 Privacy-safe Context Capsule

Raw local dataを何でもcloudへ送らない。
Local Context Engineが最小限に要約/抽出する。

```ts
ContextCapsule {
  activeApp
  userIntent
  referents[]
  selectedText?
  summarizedLocalEvidence[]
  relevantWorldEntities[]
  allowedRawAttachments[]
  sensitivity
}
```

Data classification:

- PUBLIC
- PRIVATE
- CONFIDENTIAL
- REGULATED

REGULATEDはplugin policyに従いcloud送信可否を決定。

---

# 7. Conversation Engine

## 7.1 目的

ChatGPT級の自然さ。

## 7.2 必須機能

- streaming response
- voice/text mixed turns
- barge-in
- cancel old response
- pronoun/reference resolution
- “それ/あれ/2番/昨日の続き”
- output modality routing
- short answer first, detail on demand
- tool progress naturalization
- conversation summary compaction
- memory retrieval
- no repeat questions when context exists

## 7.3 Conversation State

```ts
ConversationState {
  id
  recentTurns[]
  activeTopic
  activeProject
  activePerson
  activeArtifact
  activeResearchRun
  activeMeeting
  referents[]
  pendingApprovals[]
  responseMode: text | voice | mixed
}
```

## 7.4 Lane Router

内部Lane:

- chat
- dictate
- edit
- research
- action
- meeting
- specialist-agent

ユーザーには表示しない。

---

# 8. Research Engine — “検索して調査して報告”を標準機能にする

## 8.1 Flow

```text
Intent
→ Research Plan
→ Query Decomposition
→ Parallel Search
→ Fetch / Parse
→ Deduplicate
→ Source Quality Scoring
→ Claim Extraction
→ Contradiction Detection
→ Additional Search
→ Synthesis
→ Report
→ Library Artifact
```

## 8.2 Evidence Ledger

```ts
Evidence {
  id
  sourceUrl
  sourceType
  publisher
  publishedAt?
  retrievedAt
  claim
  supportTextRef
  qualityScore
  freshnessScore
  supports[]
  contradicts[]
}
```

ユーザーが後で
「この結論の根拠は？」
と聞ける。

## 8.3 Result UX

Voice output:

> 「調査できました。結論は3点です。詳しい比較表と出典は保存しました。」

Screen:

- Executive summary
- Key findings
- comparison
- confidence
- contradictions
- citations
- “continue research”
- share

## 8.4 Long task

ResearchはTask Runtimeへ移し、windowを閉じても継続。
Home/Agent Tabにprogress表示。
完成するとLibraryへ保存。

---

# 9. Action Engine

## 9.1 Tool execution surfaces

- local-native
- local-MCP
- cloud connector
- cloud-MCP
- sandbox worker
- browser/screen fallback

Priority:

```text
Native/API > MCP > structured browser automation > raw screen automation
```

Screen automationは最後のfallback。

## 9.2 Risk Policy

```text
READ
REVERSIBLE_WRITE
EXTERNAL_COMMIT
DESTRUCTIVE
REGULATED
FINANCIAL
```

例:

- email search → READ
- draft create → REVERSIBLE_WRITE
- send email → EXTERNAL_COMMIT
- delete files → DESTRUCTIVE
- modify EHR → REGULATED
- place trade → FINANCIAL

## 9.3 Approval UX

```text
送信します
To: xxx@example.com
Subject: ...

[送信] [修正]
```

内部tool名やJSONを見せない。

## 9.4 Execution Receipt

全write actionはreceiptを残す。

```ts
ActionReceipt {
  id
  taskId
  toolId
  actor
  inputsHash
  resultRef
  executedAt
  risk
  approvedBy?
  reversibleUntil?
}
```

---

# 10. World Model

## 10.1 目的

会話ログではなく「ユーザーの世界の現在状態」を持つ。

Entities:

- Person
- Organization
- Project
- Conversation
- Meeting
- Task
- Commitment
- Decision
- Artifact
- ResearchRun
- Evidence
- Event
- Preference
- DomainEntity

Edges:

- belongs_to
- works_with
- mentioned_in
- decided_in
- produced_by
- assigned_to
- depends_on
- related_to

## 10.2 技術

初期段階ではGraph DBを導入しない。
PostgreSQL + JSONB + relation edge table + pgvectorで実装する。

```text
world_entities
world_edges
world_facts
world_embeddings
world_events
```

必要になった時だけGraph DBへprojectionする。

## 10.3 Memory Write Policy

全会話を“記憶”にしない。
保存候補:

- explicit preferences
- commitments
- decisions
- recurring people/projects
- artifact lineage
- task status
- approved corrections

Temporary chatはshort-term only。

---

# 11. STT Architecture

音声を2用途に分ける。

## 11.1 Task Dock STT

目的:

- low latency
- high Japanese accuracy
- privacy
- command/dictation

推奨:

```text
Mic
→ Local VAD
→ Local streaming ASR
→ partial text
→ endpointing
→ optional confidence-based cloud correction
→ Conversation Engine
```

既存のローカルSTT資産を再利用し、モデルは差し替え可能なProvider interfaceにする。

```ts
interface StreamingSTTProvider {
  start(config): Session
  pushAudio(frame)
  onPartial(cb)
  onFinal(cb)
  stop()
}
```

Provider候補:

- local sherpa-onnx Japanese model
- cloud fallback
- future CoreML/Whisper/other provider

Task Dockではspeaker diarization不要。

## 11.2 Meeting STT — Dual Path

### 重要な仕様判断

Google Speech-to-Textの最新Chirp 3は高精度だが、現時点の公式仕様ではdiarizationは `Recognize` / `BatchRecognize` で、Streaming diarizationではない。
一方V1 Streaming Recognitionはspeaker diarizationをサポートする。

したがってMeetingは次の二重経路にする。

### Live Path

```text
Mic/System Audio
→ Audio Mixer
→ Google STT V1 Streaming gRPC
   enableSpeakerDiarization=true
→ interim transcript
→ speaker-tagged aggregate
→ Segment Stabilizer
→ Real-time Translation
→ UI
```

- interim_results=true
- 100ms前後audio frameを基本
- speaker count rangeはmeeting metadataから推定
- speaker tagsは結果更新で変わる可能性があるため、UIは確定前を淡色表示

### Final Accuracy Path

会議終了後:

```text
Recorded Audio
→ Google STT V2 Chirp 3 BatchRecognize
→ diarization
→ punctuation / timestamps
→ transcript reconciliation
→ speaker segment normalization
→ final transcript
→ summary/decisions/action items
→ Library
```

この方式によりリアルタイム性と最終品質を両立する。

## 11.3 Speaker Naming

Default:

- Speaker 1
- Speaker 2

ユーザーが1回名前を割り当てると、その会議中は固定。
Calendar参加者候補を提示する。

音声embeddingによる人物自動特定はbiometric扱いになり得るため、初期版では採用しない。

---

# 12. Real-time Translation

## 12.1 Principle

interim文字列を毎token翻訳すると画面が揺れる。

二段階:

- provisional translation: stable partial boundary
- committed translation: STT final segment

## 12.2 Pipeline

```text
Diarized Transcript Segment
→ language detection
→ segment finality scorer
→ Translation Provider
→ translated segment
→ UI
```

Provider interface:

```ts
interface TranslationProvider {
  translate(segment, sourceLang, targetLang, glossary?): Promise<Result>
}
```

Google側ではChirp 2に日本語↔英語のspeech translation supportがあるが、meetingのspeaker-tag continuityを優先し、初期版は **diarized text → Translation** の分離pipelineを正本とする。

### UI

```text
Speaker 1   13:04:21
本日の売上について確認します。
Let's review today's sales.
```

### 目標

final STT segment確定後の翻訳表示 p95 < 2秒。

---

# 13. Meeting UX

## Start

Task Dock:

> 「会議を記録」

or Calendar card [議事録を開始]

## During

```text
┌ Live Meeting ───────────────────────────────┐
│ 00:18:42           JP → EN       ● REC      │
│                                            │
│ S1  売上の数字ですが…                      │
│     Regarding the sales figures...         │
│                                            │
│ S2  来月から変更します。                    │
│     We will change it starting next month. │
│                                            │
│ [Mark Decision] [Mark Task]                │
└────────────────────────────────────────────┘
```

## After

自動生成:

- final transcript
- translated transcript
- summary
- decisions
- action items
- unresolved questions
- follow-up draft
- related documents

全部LibraryのMeeting bundleとして保存。

---

# 14. Agent Package Architecture

専業AIエージェントは単なるpromptではない。

```text
Agent Package
├ Prompt/Skills
├ Tools/Connectors
├ Domain Schema
├ Retrieval Rules
├ Policies
├ Dashboard Schema
├ Workflows
├ Evaluations
└ Migrations
```

## 14.1 Dashboard Schema

初期版は任意HTML/JSを直接読み込ませない。
Core UI KitのJSON schemaで描画。

Components:

- metric
- text
- table
- chart
- timeline
- kanban
- entity list
- entity detail
- action button
- approval card
- file preview

例:

```json
{
  "layout": "grid",
  "items": [
    {"type":"metric","bind":"pipeline.total"},
    {"type":"chart","bind":"pipeline.byStage"},
    {"type":"table","bind":"opportunities"}
  ]
}
```

高度な独自UIはverified pluginのみsandboxed webviewを許可。

---

# 15. 専業Agent別仕様

## 15.1 Image Agent

- text-to-image
- image edit
- variation
- background remove
- inpaint/outpaint
- history
- prompt/version lineage
- Library asset auto-save

Dashboard:

- generation history
- projects
- favorite styles
- source/derived lineage

## 15.2 Video Agent

- text/image-to-video
- edit
- clips
- subtitle
- voiceover
- storyboard
- render jobs

Dashboard:

- timeline/projects
- render queue
- assets

## 15.3 Sales CRM Agent

Entities:

- Account
- Contact
- Opportunity
- Activity
- NextAction

Functions:

- meeting prep
- call notes to CRM
- pipeline analysis
- follow-up drafts
- opportunity risk
- next best action

## 15.4 Care Support Agent

- resident/client profile
- shift notes
- care plan support
- incident draft
- handoff summary
- schedule

REGULATED policy required。

## 15.5 EHR Agent

高リスク領域。

初期版はread/assist/draft中心。

- record search
- encounter summary
- draft note
- source citation
- structured extraction

Write-backは明示承認 + audit。
診断/治療を自律決定しない。

## 15.6 Architecture Agent

- project files
- drawings
- BIM metadata
- RFIs
- revisions
- code/regulation research
- issue tracking

Dashboard:

- project status
- drawing revisions
- open issues
- RFI

## 15.7 Stock Research/Trading Agent

Research:

- watchlists
- market/news
- filings
- earnings
- positions
- scenario/risk

Execution:

- default = research/draft order only
- broker order = FINANCIAL policy
- explicit confirmation
- amount/price/order-type readback
- audit

---

# 16. Backend — Greenfield Architecture

## 16.1 Split

```text
DESKTOP / LOCAL CONTROL PLANE
  Tauri + Rust
  React/TypeScript
  local audio
  OS context
  local filesystem
  secrets/keychain
  local tool execution
  local STT
        │
        │ secure API / WS
        ▼
CLOUD CONTROL PLANE
  API Gateway
  Auth/Tenant
  Conversation
  Task/Workflow
  Research
  Meeting
  Library
  Share
  Plugin Registry
  World Model
        │
        ▼
WORKER PLANE
  research workers
  generation workers
  document workers
  domain workers
  sandbox execution
```

## 16.2 Recommended Stack

Desktop:

- Tauri v2
- Rust core
- React + TypeScript
- SQLite local cache
- Keychain/credential vault

Backend:

- TypeScript / Node.js API services
- Python only for ML/data workloads
- PostgreSQL
- pgvector
- Redis
- Object Storage (GCS/S3)
- Temporal for durable workflows
- WebSocket/SSE for realtime progress
- gRPC where audio streaming benefits

GCP deployment例:

- Cloud Run: API/stateless services
- Cloud SQL PostgreSQL
- Memorystore Redis
- GCS
- Pub/Sub
- Secret Manager/KMS
- Temporal Cloud initially

## 16.3 Why Temporal

Agent/Research/Meeting processingは長時間・retry・approval待ち・再開がある。
単純queueだけでは状態管理が破綻する。

Workflow例:

```text
ResearchWorkflow
  search
  fetch
  analyze
  wait/retry
  synthesize
  create artifact

AgentActionWorkflow
  plan
  execute reads
  wait approval
  execute write
  verify
  receipt
```

---

# 17. Service Boundaries

## api-gateway

- auth
- tenant routing
- rate limit
- REST/WebSocket

## conversation-service

- conversations
- turns
- streaming
- context references

## context-service

- world/context retrieval
- capsule assembly

## task-service

- task lifecycle
- Temporal integration
- progress

## research-service

- planning
- search adapters
- evidence
- reports

## meeting-service

- meeting session
- audio stream metadata
- STT orchestration
- translation
- finalization

## library-service

- artifact metadata
- upload/download
- versions
- indexing

## share-service

- share token
- passwords
- expiry
- public viewer auth

## plugin-registry

- catalog
- signatures
- versions
- compatibility
- install state

## agent-runtime

- skills
- tools
- domain policies
- delegation

## world-model-service

- entities
- relationships
- facts
- memory retrieval/write

## notification-service

- desktop push
- email/mobile future
- proactive heartbeat

---

# 18. Core Data Model

Primary tables:

```text
users
tenants
devices
sessions
conversations
turns
tasks
task_events
approvals
action_receipts
artifacts
artifact_versions
shares
share_access_logs
meetings
meeting_segments
meeting_speakers
translations
research_runs
evidence
world_entities
world_edges
world_facts
plugins
plugin_versions
plugin_installs
plugin_permissions
agent_profiles
agent_runs
connector_accounts
audit_events
```

全tenant tableにtenant_id。
外部writeはaudit mandatory。

---

# 19. API Contract（例）

## Conversation

```text
POST /v1/conversations
POST /v1/conversations/{id}/turns
GET  /v1/conversations/{id}/stream
```

## Tasks

```text
POST /v1/tasks
GET  /v1/tasks/{id}
POST /v1/tasks/{id}/cancel
POST /v1/tasks/{id}/approve
```

## Meeting

```text
POST /v1/meetings
WS   /v1/meetings/{id}/audio
GET  /v1/meetings/{id}/stream
POST /v1/meetings/{id}/finish
```

## Library

```text
GET  /v1/artifacts
POST /v1/artifacts
GET  /v1/artifacts/{id}
POST /v1/artifacts/{id}/share
```

## Plugin

```text
GET  /v1/plugins/catalog
POST /v1/plugins/{id}/install
POST /v1/plugins/{id}/connect
POST /v1/plugins/{id}/update
DELETE /v1/plugins/{id}
```

---

# 20. Realtime Event Contract

すべてのTask/Conversation/Meetingは統一event envelopeを使う。

```json
{
  "event_id": "...",
  "type": "task.progress",
  "timestamp": "...",
  "conversation_id": "...",
  "task_id": "...",
  "sequence": 42,
  "payload": {}
}
```

Types:

- conversation.delta
- conversation.completed
- task.started
- task.progress
- task.waiting_approval
- task.completed
- task.failed
- tool.started
- tool.completed
- research.source_found
- research.evidence_added
- meeting.transcript.partial
- meeting.transcript.final
- meeting.translation.final
- artifact.created

sequenceでreconnect後の再送を可能にする。

---

# 21. Security / Privacy

## Local-first boundaries

Local-only candidates:

- raw microphone buffer
- OS accessibility context
- file index
- secrets
- plugin tokens

Cloudへ送る時はpolicy/checkを通す。

## Credential

Desktop:

- Keychain / Credential Manager

Cloud:

- Secret Manager + KMS
- OAuth tokens encrypted at rest

## Plugin

- signed manifests
- permission scopes
- no implicit filesystem/network
- host-only OS actions
- sandbox workers
- MCP server allowlist/trust state

## Audit

append-only audit event:

- actor
- task
- tool
- approval
- external side effect
- hash/reference

---

# 22. Regulated Domain Policy

専業Agentを同じ安全レベルで扱わない。

Profiles:

- GENERAL
- ENTERPRISE
- REGULATED_HEALTH
- CARE
- FINANCIAL

Plugin manifestでprofile mandatory。

REGULATED_HEALTH:

- strict tenant isolation
- no training on customer data
- source provenance
- write approval
- audit retention
- regional data policy

FINANCIAL:

- read/research separated from execution
- order preview mandatory
- explicit confirmation
- broker receipt
- loss/risk guardrails

---

# 23. UX Performance SLO

目標値:

- Task Dock show: p95 < 120ms
- mic capture start: p95 < 150ms
- local STT first partial: p95 < 350ms
- simple text first token: p95 < 800ms
- simple read tool result: p95 < 2s
- long research acknowledgment: < 1s
- first research evidence: p95 < 4s
- meeting live transcript: p95 < 900ms perceived
- translation after final segment: p95 < 2s
- Home cached load: < 300ms

2秒超taskにはprogressを出す。

---

# 24. Failure / Recovery

全長時間taskは以下を満たす。

- idempotency key
- checkpoint
- exponential retry
- cancellation
- crash resume
- network reconnect
- duplicate event protection
- immutable action receipt

Tool failure時:

```text
API connector fail
→ retry
→ alternate connector
→ browser structured automation
→ screen automation
→ user handoff
```

勝手に成功扱いしない。

---

# 25. Evaluation / Acceptance

## Conversation

- 30 turn reference resolution
- interrupted voice
- topic switch
- mixed text/voice
- “昨日の続き”

## Task Dock STT

- Japanese WER/CER benchmark
- proper nouns
- office noise
- latency

## Meeting

- 2/3/5 speaker diarization
- Japanese
- overlap speech
- live vs final transcript diff
- translation quality
- reconnect

## Research

- source freshness
- citation correctness
- contradiction handling
- unsupported claim rate

## Action

- permission bypass tests
- duplicate execution
- stale approval
- tool timeout
- recovery

## Plugin

- malicious manifest
- permission escalation
- incompatible update
- rollback

---

# 26. Repository Structure（推奨）

```text
/apps
  /desktop                 # Tauri + React
  /share-web               # public artifact viewer

/services
  /api-gateway
  /conversation
  /context
  /task
  /research
  /meeting
  /library
  /share
  /plugin-registry
  /agent-runtime
  /world-model
  /notification

/workers
  /research-worker
  /document-worker
  /media-worker
  /domain-worker

/packages
  /contracts
  /ui-kit
  /agent-sdk
  /plugin-sdk
  /policy
  /telemetry

/plugins
  /builtin
    /gmail
    /calendar
    /finder
    /meeting
    /research

/infra
  /terraform
  /cloudrun
  /db

/evals
  /conversation
  /stt
  /meeting
  /research
  /actions
  /plugins
```

---

# 27. DeepNote資産から再利用するもの

新サービスはバックエンドを作り直すが、成熟した技術資産は捨てない。

再利用候補:

- Task Dockのwindow/focus/keyboard/mouse routingノウハウ
- local STT
- TTS/voice asset packaging
- realtime voice interruption
- App Attest/secure brokerの知見
- CodeApply的なsafe execution/verification思想
- shared-linkのpassword/expiry思想
- meeting preparation / summary UI知見
- local/cloud privacy boundary
- evidence ledger的設計

再利用しないもの:

- 旧情報設計
- 旧backendの密結合
- 旧機能別画面遷移
- 旧Agentごとの個別実装
- hard-coded provider routing

---

# 28. Implementation Phases

## Phase 0 — Foundation

- monorepo
- auth/tenant
- event contract
- task runtime
- library
- plugin manifest
- local host bridge

Exit:

- create task → progress → result artifact

## Phase 1 — Universal Interface

- Task Dock v2
- text/voice
- Conversation Engine
- Context Engine basic
- local STT
- Home

Exit:

- OSどこからでも話す/打つ
- simple search/action

## Phase 2 — Research + Library

- Research Engine
- Evidence Ledger
- report artifact
- share links/password

Exit:

- 「調査して報告」→ Library → secure share

## Phase 3 — Meeting

- Google V1 streaming diarization
- realtime transcript
- realtime translation
- audio recording
- Chirp 3 final pass
- meeting artifact bundle

Exit:

- multi-speaker meeting E2E

## Phase 4 — Plugin Platform

- Plugin Store
- install/update
- permissions
- MCP
- dashboard schema
- Agent Packages

Exit:

- plugin installだけでAgent + Dashboardが増える

## Phase 5 — First Specialist Agents

優先:

1. Image
2. Sales CRM
3. Video

regulated pluginsは後段。

## Phase 6 — World Model / Proactivity

- entity graph
- commitment tracking
- daily brief
- proactive cards

Exit:

- “今日気にすべきこと”が精度高く出る

## Phase 7 — Regulated/Financial

- Care
- EHR
- Architecture
- Stock execution

個別compliance gateを持つ。

---

# 29. MVPを削り過ぎないための最小完成形

MVPでも以下は必要。

```text
4 tabs
Task Dock v2
Text + Voice same conversation
Context basic
General Agent
Research Agent
Meeting Agent
Library
secure share
Plugin catalog/install framework
at least Gmail/Calendar/Drive/Finder connectors
one specialist Agent
World Model minimal
```

逆にMVPでは後回し可能:

- third-party plugin publishing
- custom dashboard JS
- biometric speaker recognition
- full EHR write-back
- automatic stock trading
- mobile client

---

# 30. Product Acceptance — “iPhone moment”

初回ユーザーが10分以内に以下のいずれかを体験できること。

### Case A — Research

> 「この会社について競合と比較して調べて」

→ sources
→ report
→ Library
→ share link

### Case B — Meeting

> 「この会議を記録して英語も出して」

→ speaker-separated live transcript
→ realtime translation
→ final minutes

### Case C — Agent

> 「来週の商談準備して」

→ Calendar
→ email
→ related files
→ prep document
→ Library

この瞬間に「機能を理解した」ではなく、**自分の仕事が短縮された**と感じることを合格基準とする。

---

# 31. 最終製品像

ユーザーは4タブを覚えるだけ。
実際にはTask Dockだけでも大半が完結する。

```text
ユーザー
  「今日の会議準備して」
        ↓
Task Dock
        ↓
Context Engine
        ↓
World Model + Calendar + Email + Library
        ↓
Research/Action Agent
        ↓
資料生成
        ↓
Library保存
        ↓
HomeにDone card
        ↓
必要ならShare
```

専業AIエージェントを追加しても操作原理は変わらない。

> **話す / 打つ → AIが理解する → 調べる/動く → 結果がLibraryに残る**

この一貫性を壊さないことが、最上位UI/UXの最重要条件である。

---

# 32. Current External Findings / Design Constraints

- VoiceOSは2026年8月時点で21の公式integrationをApp Storeとして提供し、custom MCP integrationも追加可能。Integrationごとにツール数・対応OS・確認が必要な操作を明示している。
- VoiceOSはsystem-wide voice layer、screen-aware assistant、Agent confirmationのUXを継続改善している。
- Super InternはModeをProject Data + Prompt + Toolsの組み合わせとして説明し、Mode Packagesを用途別に追加する思想を採る。またmessaging-native UXにより“新しい場所へ移動させない”ことを重視する。
- Google Cloud STT V1はStreaming Recognition + Speaker Diarizationをサポートする。
- Google Chirp 3は日本語transcriptionをStreaming/Recognize/BatchRecognizeでサポートする一方、公式のdiarization language availabilityはRecognize/BatchRecognize側として示されている。したがってLiveとFinalのdual pathを本仕様の正本とする。
- Google Chirp 2はja-JP→en-US / en-US→ja-JPのspeech translation pairをサポートするが、speaker diarization continuityを守るため、本仕様ではdiarized text後段translationを標準とする。

