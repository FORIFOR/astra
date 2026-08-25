<!--
  この Markdown は docs/spec/astra_ui_ux_detailed_spec_v0.1.docx から機械抽出したもの。
  正本は .docx 側。読みやすさのために表を Markdown 表へ変換してある。
  図は docs/spec/astra_ui_ux_concept.png（原文 図0-1）。
-->

ASTRA
# UI / UX 詳細仕様書

人とデジタル世界の間にある、新しい仕事のインターフェース

| 本仕様書の位置づけ既存「新AIプラットフォーム 詳細設計仕様書 v0.1」を正本とし、UI/UXのみを実装可能な粒度まで具体化する。従来のAIダッシュボードではなく、Invisible → Task Dock → Work Surface → Workspace と連続変形する「Surface Continuity」を中核に置く。 |
|---|

| 項目 | 内容 |
|---|---|
| Document | Astra UI/UX Detailed Specification |
| Version | 0.1 |
| Status | Implementation-ready draft |
| Primary platform | macOS / Windows Desktop |
| Core navigation | Home / Work / Library / Apps |
| North Star | Intent → Done → Receipt |

図0-1  コンセプト参照。ピクセル仕様ではなく、Surface ContinuityとMeeting UXの方向性を示す。

## 目次

1. 目的とUX原則
2. 情報設計とSurface Model
3. Global Interaction State Machine
4. Task Dock
5. Context Lens
6. Work Surface / Task Card
7. Full Workspace Shell
8. Home
9. Work
10. Library
11. Apps
12. Meeting / Recording UX
13. Research UX
14. Action / Approval UX
15. Evidence / Provenance UX
16. Notifications / Proactivity
17. Visual Design System
18. Motion / Feedback
19. Accessibility
20. Keyboard / Voice shortcuts
21. Error / Recovery / Offline
22. Security / Privacy UI
23. Telemetry / UX Metrics
24. Implementation order
25. Acceptance criteria
Appendix A. Component inventory
Appendix B. Wireframes

## 1. 目的とUX原則

Astraは「AIアプリを開いて、Agentやモードを選ぶ」製品ではない。OS上の現在作業を理解し、最小Surfaceから仕事を受け取り、必要な時だけUIを拡張し、成果物・実行結果・根拠まで残すWork Interfaceとする。

### 1.1 UX North Star

Intent → Understand Context → Work → Approval (if needed) → Done → Artifact / Receipt

### 1.2 絶対原則

No Mode: Chat / Research / Agent / Dictation / Meeting をユーザーに選ばせない。
Show Work, Not Agents: 通常ユーザーにはAgent編成を見せず、「仕事の進行」を見せる。
Context is Visible: Astraが今回何を参照しているかを確認できる。
Surface Continuity: Capsule → Card → Side Panel → Workspaceの間でTask/Conversation/Contextを切らない。
Quiet by Default: 通常時は不可視。必要な時だけ出現し、ユーザーの主作業を奪わない。
Approval Describes Consequence: 「Approve」ではなく「3件送信する」「CRMを更新する」のように結果を明示する。
Evidence on Demand: 根拠は保持するが、通常画面を引用一覧で埋めない。
Done means Done: 回答ではなく、成果物・外部操作・保存・実行receiptまで完了状態に含める。

### 1.3 B2B UIで優先する品質

| 優先度 | 品質 | 判断基準 |
|---|---|---|
| P0 | 信頼性 | 何を見て・何をしようとして・何をしたかが追える |
| P0 | 速度 | 1〜2ステップで依頼開始。待ち時間はsemantic progressで説明 |
| P0 | 中断耐性 | アプリを閉じても長時間Taskが継続・復帰できる |
| P1 | 学習コスト | Agent名・モデル名・tool名を覚えなくてよい |
| P1 | 密度 | 業務画面は情報密度を保ちつつ装飾を最小化 |
| P1 | 安全 | 外部送信・変更・削除・金融/規制操作は明示確認 |

## 2. 情報設計とSurface Model

### 2.1 トップレベルNavigation

| Tab | 役割 | 通常ユーザーが期待する答え |
|---|---|---|
| Home | 今必要なこと + universal entry | 「今、何をすべき？」 |
| Work | 実行中 / 待機 / 完了タスク | 「仕事はどこまで進んだ？」 |
| Library | 成果物・会議・Researchの正本 | 「結果はどこ？」 |
| Apps | Pack / Connector / Domain capability | 「何を追加できる？」 |

| 名称方針内部実装で「AI Agent」「Plugin」を保持しても、一般ユーザーのトップNavigationでは Work / Apps を使用する。管理者向け設定では Agent Runtime / Plugin Registry 等の技術名称を許可する。 |
|---|

### 2.2 4段階Surface

INVISIBLE  ↓ summonTASK DOCK (Capsule)  ↓ complexity / progressWORK SURFACE (Card / Side Panel)  ↓ deep inspectionWORKSPACE (Full App)

| Surface | 表示条件 | 主目的 | 閉じてもTaskは継続? |
|---|---|---|---|
| Invisible | 通常状態 | ユーザーの作業を邪魔しない | — |
| Task Dock | ショートカット / voice / selection | 意図を受け取る | Yes |
| Work Surface | 2秒超 / multi-step / approval | 進捗・承認・短い結果 | Yes |
| Workspace | 比較・編集・監査・大量情報 | 深い操作・管理 | Yes |

## 3. Global Interaction State Machine

HIDDEN → READY → LISTENING / TYPING → UNDERSTANDING → WORKINGWORKING → WAITING_APPROVAL → WORKING → RESULT → MINIMIZEDWORKING → FAILED_RECOVERABLE / FAILED_BLOCKEDRESULT → EXPAND_WORKSPACE / CONTINUE / DISMISS

| State | ユーザー表示 | UI要件 |
|---|---|---|
| HIDDEN | なし | 常駐感を出さない |
| READY | 入力Capsule | Text + Mic + Attachのみ |
| LISTENING | live transcript + mic state | 巨大波形を避ける。誤認識を即修正可 |
| UNDERSTANDING | 0.3〜1.2秒程度の短いstatus | 「文脈を確認中」等。spinnerだけは禁止 |
| WORKING | semantic steps | Agent名ではなく仕事の工程を表示 |
| WAITING_APPROVAL | consequence card | 何が起こるか明示。primary buttonに結果を書く |
| RESULT | summary + next actions | 成果物/receiptへアクセス可 |
| FAILED_RECOVERABLE | 原因 + retry/alternative | 成功扱いしない |
| FAILED_BLOCKED | 必要な人間操作 | 不足権限・接続・入力を具体表示 |

## 4. Task Dock

Astraの最重要UI。OS上のどのアプリからでも呼び出せる。Chat画面ではなく「Intent Bar」であり、Voice / Text / 画面 / 選択範囲 / ファイルを同一Conversationへ入れる。

### 4.1 Geometry

| 状態 | 幅 | 高さ | 備考 |
|---|---|---|---|
| Ready | 560 px | 56 px | 中央下寄り。画面下端から48〜72px。 |
| Typing expanded | 640 px | 96〜140 px | multi-line最大4行。 |
| Listening | 560 px | 96 px | live transcript 2行 + minimal waveform。 |
| Context peek | 640 px | 140〜220 px | Context chips + “+N” 展開。 |
| Work card detached | 520〜620 px | 最大520 px | 主作業ウィンドウを覆い過ぎない。 |

### 4.2 Placement

デフォルトはprimary display下部中央。メニューバー/タスクバーと重ならない。
ユーザーがDockを移動した場合はそのdisplay内で位置を記憶。
fullscreen app時もoverlay可能。ただしscreen sharing中は表示内容のプライバシー設定を尊重。
multi-monitorでは最後に操作したdisplayに出す。

### 4.3 Content hierarchy

[Astra mark]  [Intent text................................] [Mic] [+]              [Context chip] [Context chip] [Context chip] [+4]

| 要素 | 規則 |
|---|---|
| Intent field | placeholderは「何をしますか？」。機能例を常時ローテーションしない。 |
| Mic | 押下=continuous listening、global shortcut hold=push-to-talk。 |
| Attach + | File / Screen / Selectionの明示追加。技術的tool一覧は出さない。 |
| Context chips | 最大3個 + “+N”。例: Q4提案.pptx / A社 / 明日10:00。 |
| Send | Enter送信、Shift+Enter改行、Cmd/Ctrl+Enterでも送信可。 |

### 4.4 Dock behavior rules

簡単な質問はDock内で短く答え、full appへ遷移しない。
2秒を超えるTaskは1秒以内にacknowledgementを返しWork Surfaceへ遷移。
長文生成・Research・Meeting finalizeはbackground durable taskへ移す。
Esc 1回: 現在のoverlayを縮小。Esc 2回: dismiss。実行中Taskはキャンセルしない。
実行キャンセルは明示的な「停止」から行う。DismissとCancelを同一操作にしない。

## 5. Context Lens

ユーザーが「Astraが何を理解しているか」をいつでも確認できるB2B trust surface。通常はchips、必要時だけ詳細を開く。

### 5.1 Context categories

| Category | 例 | 表示 |
|---|---|---|
| Current | foreground app / file / selected text | Current screen / Q4提案.pptx |
| Entity | Person / Account / Project | A社 / 田中様 |
| Schedule | calendar event | 明日 10:00 商談 |
| Internal | related mail / Drive / Library | 関連メール8件 / 資料4件 |
| External | Web / public sources | Web search enabled |
| Policy | sensitivity / restricted data | Confidential / Local-only |

### 5.2 Trust rules

Context Lensには「今回の依頼で実際に使う/使った情報」を表示する。アクセス可能な全データ一覧ではない。
Context sourceごとにremoveできる。remove後はtask planを再評価する。
REGULATED / CONFIDENTIALはアイコンと短いラベルを付け、cloud送信可否を説明可能にする。
“Why this?” から関連理由を一段だけ説明する。モデル内部推論は表示しない。

## 6. Work Surface / Task Card

複雑な処理の進捗を見せる中間Surface。Agent orchestrationは隠し、ユーザーの仕事単位で表現する。
A社 商談準備                       進行中✓ 過去の商談とメールを確認✓ 案件状況を整理● 最新競合情報を調査中             12 sources○ 提案資料を更新○ 商談ブリーフを作成                                     [詳しく見る]

### 6.1 Semantic progress

| 表示する | 表示しない |
|---|---|
| 「競合情報を調査中」 | ResearchAgent #3 running |
| 「提案資料を更新中」 | Document tool call 19/23 |
| 「確認待ち」 | workflow waiting activity |
| 「12 sources」 | crawler worker count |

### 6.2 Progress rules

進捗率は真の進行率を計算できるTaskのみ表示。推定%の乱用をしない。
未知の長さのResearchはstep state + source count + elapsed timeで表現。
waiting approvalは進捗中と混ぜず、明確なattention stateへ遷移。
失敗stepは赤く固定せず、retry中なら「再試行中」に置き換える。

## 7. Full Workspace Shell

深く扱う必要がある時だけ開く。チャット中心ではなくWork/Object中心。Conversationは右下/下部composerとして常に継続できる。

### 7.1 Desktop layout

| 領域 | 標準寸法 | 内容 |
|---|---|---|
| Primary sidebar | 208 px / collapsed 64 px | Home / Work / Library / Apps + account |
| Top bar | 56 px | page title / global search / notifications / profile |
| Main canvas | min 640 px | 現在のwork/object |
| Inspector | 320 px optional | Context / Evidence / Activity / metadata |
| Composer | 48–72 px | “Ask Astra…”。必要時だけ表示 |

### 7.2 Window breakpoints

| 幅 | 挙動 |
|---|---|
| ≥ 1280 px | sidebar + main + inspector 3-column |
| 960–1279 px | inspectorはdrawer。sidebar 64–208切替 |
| 720–959 px | sidebar collapsed、main single column |
| < 720 px | desktop MVPでは最低幅720pxを提示。将来mobile spec別途。 |

## 8. Home

HomeはKPI dashboardではなく「今必要な仕事への入口」。最大3つのAttention、最大3つのActive work、Recentを短く表示する。
Good morning[ 何を終わらせますか？                         [Mic] ]Attention10:00 A社 商談  前回から価格条件が変更      [準備する]Research complete 半導体市場調査             [見る]Waiting for you 3件のメール送信              [確認する]Active work● 競合20社調査  12 sources  進行中

### 8.1 Home content rules

Attentionは最大3件。ProactiveScoreによりrankし、4件目以降は「すべて見る」。
「次の会議」「未処理approval」「完了した長時間Task」「期限付きcommitment」を優先。
営業KPIや業務KPIはHomeに常設しない。Domain dashboardはWorkの専用viewへ。
空状態では機能説明ではなく「今、面倒なことを1つ頼んでください」を中央表示。

## 9. Work

Agentタブの代替。仕事単位で管理し、裏のAgentは詳細/管理者向けにのみ開示する。

| Filter | 意味 |
|---|---|
| Active | 現在実行中 / scheduled / retry中 |
| Waiting | approval / human input / permission待ち |
| Done | 完了。artifactまたはreceiptあり |
| Failed | 回復不能 / user handoffが必要 |
| All | 全履歴 |

### 9.1 Work row

● A社 商談準備  最新競合情報を調査中 · 12 sources  Started 14:02                           [Open]

### 9.2 Work detail

| Tab | 内容 |
|---|---|
| Overview | goal / current state / next step / Context chips |
| Progress | semantic task steps / timestamps |
| Outputs | Artifacts / receipts / related meetings |
| Evidence | Research / sources / contradictions |
| Activity | tool/audit eventを人間可読に要約 |

## 10. Library

AI成果物の正本。ファイルブラウザではなく、Meeting / Research / Document / Media / Code / Domain outputを横断するArtifact memory。

### 10.1 Default view

| 要素 | 仕様 |
|---|---|
| Search | semantic + keyword。自然文「先月のA社の決定事項」可。 |
| Type chips | All / Meeting / Report / Document / Image / Video / Other |
| Filters | Project / Person / Date / Generated by / Sensitivity |
| Card metadata | type / date / source task / lineage summary |
| Preview | 右panelまたはmain。download/shareはpreviewから。 |

### 10.2 Lineage UX

A社 提案書 v5Derived from: Meeting Aug 26 · Research 12 sources · Pricing policy v7Produced by: A社 商談準備[View lineage]
Shareはdefault OFF。Share開始時にexpiry / password / download / allowlistを設定し、共有状態はartifact headerに常時可視化する。

## 11. Apps

Plugin/Integration Storeをユーザー向けに「できる仕事を増やす場所」として見せる。Connector単体よりPackを優先表示。
Sales Pack商談準備 / 会議記録 / Follow-up / CRM更新 / Pipeline分析Uses: Gmail · Calendar · Drive · SalesforceData: Mail Read · CRM Read/WriteRequires confirmation: Send email / Update opportunity                                      [Install Sales Pack]

### 11.1 App detail must show

Publisher / verified / version / updated date
「できる仕事」を先に、tool数はsecondary metadata
Accessed data / permission scope / local vs cloud
確認が必要な外部操作
Installed Agent/Work views / dashboards
Pricing/usage / changelog / uninstall impact

## 12. Meeting / Recording UX

Meetingは巨大な録音画面を常駐させない。「Start confirmation → minimal recording indicator → notes-first surface → transcript on demand → finalize → Meeting Artifact」の1本のSurfaceとして実装する。

### 12.1 Start confirmation

A社 新規提案を記録します✓ マイク✓ システム音声✓ リアルタイム文字起こし  日本語✓ 翻訳                       English参加者への録音・文字起こし同意を確認してください。[キャンセル]                              [記録を開始]

| 項目 | 仕様 |
|---|---|
| Consent | 開始前に明示。企業policyで文言差替え可。 |
| Audio sources | Mic/System audioを個別状態表示。 |
| Language | auto detect可だが、会議開始時にactive languageを表示。 |
| Translation | Off / target language。開始後変更可。 |
| Calendar context | 会議名/参加者/関連projectをContextとして提示。 |

### 12.2 Minimal recording indicator

● REC 18:42   A社 新規提案   3 speakers       [Pause] [Stop]
標準幅360–420px、高さ48–56px。画面下部またはユーザー指定位置。
常にREC状態を明確にする。透過し過ぎて録音中か分からない状態は禁止。
他アプリの操作を邪魔しない。クリックでMeeting Surfaceを展開。
音声レベルは細いmeterのみ。装飾的な大波形を主役にしない。

### 12.3 Meeting Surface: Notes first

A社 新規提案                          ● REC 18:42  JP→EN────────────────────────────────────────────────────Notes                                      Transcript >価格条件について・導入時期は10月・先方は初期費用を懸念+ メモ[重要]      [決定]      [ToDo]                 [Ask Astra]

| 要素 | 仕様 |
|---|---|
| Notes | default main canvas。ユーザーが自由入力。AIは自動で上書きしない。 |
| Transcript | default closed。右panel 320–360pxで展開。 |
| Markers | 重要 / 決定 / ToDo。1 clickでtimestamp mark。 |
| Ask Astra | 会議文脈で質問。回答は会議を邪魔しない短いpanel。 |
| Translation | Transcript行の下にsecondary line。toggle可能。 |

### 12.4 Live transcript

14:18:21  田中初期費用が少し気になっています。We are concerned about the upfront cost.14:18:37  伊藤分割については調整できます。We can discuss installments.
interim textはmuted表示、final segmentで通常色へ。
speaker tagが再評価された場合はvisual jumpを抑え、final確定後に更新。
ユーザーがSpeaker 1→田中と割り当てると会議内固定。
overlap/uncertain segmentはconfidence iconを出し、誤確定を避ける。

### 12.5 Stop → Finalize

Meeting ended✓ Recording saved● High accuracy transcript● Speaker reconciliation○ Summary / Decisions / ToDo○ Follow-up draftYou can close this window. Processing continues.
Finalize中にwindowを閉じてもTask Runtimeで継続。Home/Workへprogress cardを出す。

### 12.6 Meeting Artifact

A社 新規提案                          42:18 · 3 participantsSummary先方は10月導入を希望。最大の懸念は初期費用。  [1]Decisions 3導入時期を10月で検討                         [2]Action items 4伊藤  修正版見積を送付  明日                  [3][Transcript] [Recording] [Related files] [Evidence]
Summary/Decision/ToDoの引用番号を押すと該当Transcript + timestamp + audio jumpをInspectorに表示する。

## 13. Research UX

Researchは検索UIではなく「調査して報告」のWork。source数・freshness・contradictionを保持し、通常UIは結論を優先する。

### 13.1 Running

競合比較を調査中✓ 主要プレイヤーを特定● 公式資料と最新ニュースを照合中   12 sources○ 矛盾を確認○ レポートを作成

### 13.2 Result

Executive summary1. ...2. ...3. ...12 sources · High confidence · 1 contradiction[Evidence] [Continue research] [Share]
EvidenceはInspectorで開く。source type / publisher / date / supports/contradictsを簡潔に表示し、詳細原文はさらに1段展開。

## 14. Action / Approval UX

READは原則確認不要。外部送信・変更・削除・規制・金融操作はRisk Policyに応じてconfirmation surfaceを出す。

| Risk | 例 | 標準UX |
|---|---|---|
| READ | search email | no approval |
| REVERSIBLE_WRITE | draft create | silent or low-friction notice |
| EXTERNAL_COMMIT | send email | explicit consequence card |
| DESTRUCTIVE | delete file | explicit + affected count + recovery info |
| REGULATED | EHR write | explicit + provenance + audit note |
| FINANCIAL | place order | amount/price/type readback + explicit confirm |

### 14.1 Consequence card

3人にメールを送信しますTo: 山田 / 田中 / 鈴木Subject: A社商談の事前確認External send · 3 messages[内容を確認]                         [3件送信する]
Primary buttonは「承認」ではなく結果を書く。
対象件数・外部/内部・取り消し可否を表示。
長い本文はpreviewへ。confirmation card自体を巨大化しない。
承認後はAction Receiptを生成し、Work/Libraryから追跡可能。

## 15. Evidence / Provenance UX

Evidence Ledgerは常時前面に出さない。結論の信頼ラベルから必要時に掘れるProgressive Disclosureを採用する。
12 sources · High confidenceOfficial 4 · Filings 3 · News 4 · Internal 1Contradictions 1[View evidence]

| Level | 表示 |
|---|---|
| L0 | source count + confidence + contradiction count |
| L1 | source groups + key claims |
| L2 | claim ↔ source relation / supports / contradicts |
| L3 | source detail / timestamp / original location |

## 16. Notifications / Proactivity

Astraは勝手に話しかけ過ぎない。Home AttentionとOS notificationを分け、InterruptCostを重視する。

| Severity | Surface | 例 |
|---|---|---|
| Info | Home only | Research completed |
| Attention | Home + subtle badge | 会議まで18分 / prep未完了 |
| Action required | OS notification + Work Waiting | approval待ち |
| Critical | OS alert only when policy requires | recording failure / regulated write blocked |

Proactive cardは最大3件。dismiss feedbackをranker改善に使うが、ユーザーの明示拒否を長期尊重する。

## 17. Visual Design System

JARVIS感はGlow/HUDではなく、文脈理解と動的Surfaceで出す。視覚はB2B向けに静かで高密度。

### 17.1 Color tokens

| Token | Light | Dark | 用途 |
|---|---|---|---|
| Canvas | #F7F8FA | #0F1115 | app background |
| Surface | #FFFFFF | #171A20 | cards / panels |
| Text | #17191D | #F2F4F7 | primary text |
| Muted | #667085 | #98A2B3 | secondary |
| Border | #E6E8EC | #2B3038 | hairline |
| Astra Accent | #5B4CF0 | #8A7DFF | selection / primary action only |
| Success | #18794E | #3CCB7F | done |
| Warning | #B54708 | #F4B860 | attention |
| Danger | #B42318 | #FF746C | destructive / failure |

### 17.2 Typography

| Role | Size | Weight |
|---|---|---|
| Page title | 24–28 | 600 |
| Section title | 16–18 | 600 |
| Card title | 14–16 | 600 |
| Body | 14 | 400 |
| Secondary | 12–13 | 400 |
| Micro/meta | 11–12 | 500 |

Default: system UI font / Noto Sans CJK JP fallback。数字/KPIでmonospaceを乱用しない。

### 17.3 Spacing / radius

| Token | Value |
|---|---|
| Base spacing | 8 px |
| Compact gap | 4 px |
| Card padding | 16–20 px |
| Large panel padding | 24 px |
| Radius small | 8 px |
| Radius standard | 12 px |
| Task Dock radius | 16 px |
| Border | 1 px hairline |

GlassmorphismはTask Dock等のfloating surfaceに限定。通常Workspaceは不透明Surface。Glowはvoice active/critical transient feedback以外では使用しない。

## 18. Motion / Feedback

| Interaction | Duration | Easing / rule |
|---|---|---|
| hover/focus | 80–120 ms | opacity/background only |
| popover/drawer | 140–180 ms | ease-out |
| Dock morph | 180–220 ms | position continuityを保つ |
| workspace expansion | 200–260 ms | 同一Taskのidentityを維持 |
| success acknowledgement | 300–500 ms | checkmark 1回。loop禁止 |

無限pulseを常用しない。Listening/active recordingのみ必要最小限。
layout shiftを避け、Card→Panel→Workspaceはanchor位置を保って拡大する。
prefers-reduced-motionではmorphをfade/instantへ簡略化。

## 19. Accessibility

主要テキスト/controlsはWCAG AA相当のcontrastを目標。
全interactive elementはkeyboard操作可能。focus ringを消さない。
44px相当のclick/touch targetを推奨。desktopでも小さすぎるicon-only buttonを避ける。
状態を色だけで表さない。icon + text + colorを併用。
Live transcriptはscreen reader向けaria-liveの頻度を抑制し、final segmentのみ通知可能にする。
会議録音状態は視覚だけでなくAccessible Nameで“Recording”を明示。

## 20. Keyboard / Voice shortcuts

| Action | macOS | Windows |
|---|---|---|
| Open/close Task Dock | Option + Space | Ctrl + Alt + Space |
| Push-to-talk | shortcut hold | shortcut hold |
| Send | Enter / Cmd+Enter | Enter / Ctrl+Enter |
| New line | Shift+Enter | Shift+Enter |
| Dismiss surface | Esc | Esc |
| Stop current output | Esc when responding | Esc when responding |
| Cancel task | explicit Stop action | explicit Stop action |
| Open Context Lens | Cmd+Shift+C | Ctrl+Shift+C |

ショートカットはSettingsで変更可能。OS/IME競合を検出した場合は初回設定で代替候補を提示する。

## 21. Error / Recovery / Offline

| ケース | 表示例 | 行動 |
|---|---|---|
| Network lost | 接続が切れました。ローカル作業は継続中。 | 自動再接続 |
| Tool timeout | Gmailの応答が遅れています。再試行中。 | retry → alternate |
| Permission missing | Calendarへのアクセスが必要です。 | 理由 + Connect |
| Approval stale | 内容が変更されたため、もう一度確認してください。 | new approval |
| Meeting STT degraded | 文字起こし精度が低下しています。録音は継続中。 | audio preserved + final pass |
| Long task failed | 完了できませんでした。途中成果は保存済みです。 | retry / handoff |

エラーは「AIが失敗しました」のような抽象表現にせず、ユーザーの仕事への影響と次の選択肢を書く。

## 22. Security / Privacy UI

local-only / cloud-used / external-sendを短いhuman-readable labelで表示可能にする。
permission requestは利用直前にpurpose-firstで出す。初回起動時の一括権限要求は禁止。
Plugin/App detailはdata accessed / write scopes / confirmation requirementsを必須表示。
共有Artifactはpublic/off・expiry・password・download可否をheaderに表示。
audit logは管理者向けだが、一般ユーザーにはAction Receiptを人間可読に提示する。

## 23. Telemetry / UX Metrics

| Metric | Target / interpretation |
|---|---|
| Dock summon p95 | < 120 ms |
| Mic capture start p95 | < 150 ms |
| Local STT first partial p95 | < 350 ms |
| Simple text first token p95 | < 800 ms |
| Long task acknowledgement | < 1 s |
| Meeting perceived transcript p95 | < 900 ms |
| Approval abandonment | monitor by risk type |
| Context Lens correction rate | 高い場合はauto-context precision問題 |
| Task completion without workspace open | 高いほどUniversal Interface価値が高い |
| Intent → Done median | 主要job-to-be-done別に計測 |

## 24. Implementation order

| Phase | UI scope | Exit |
|---|---|---|
| UI-0 | Design tokens + shell + shared state | Light/Dark + 4-tab shell |
| UI-1 | Task Dock + Context Lens | OS上でintent→context確認 |
| UI-2 | Work Surface + progress + result | durable taskの状態が見える |
| UI-3 | Home / Work / Library | task→artifact continuity |
| UI-4 | Meeting start / indicator / notes / transcript | live meeting E2E |
| UI-5 | Meeting finalize / citation jump | meeting artifact E2E |
| UI-6 | Approval / receipts | external action E2E |
| UI-7 | Apps / Pack install | Agent package追加がCore UIを破壊しない |

既存DeepNoteのTask Dock window/focus/keyboard routing資産はUI-1で再利用する。ただし旧Navigation/旧画面構成は持ち込まない。

## 25. Acceptance criteria

AC-01: ユーザーはAgent/Modeを選ばず「来週の商談準備して」でWorkを開始できる。
AC-02: Task Dock summonから入力可能状態までp95 120ms未満。
AC-03: Context Lensで今回利用するfile/account/calendar/mail等を確認・除外できる。
AC-04: 2秒超Taskはsemantic progressを出し、spinnerだけの状態を作らない。
AC-05: Dockを閉じてもlong taskが継続し、Home/Workから再開できる。
AC-06: external commitは結果を明示するconfirmationを通り、receiptが残る。
AC-07: Meeting開始時に録音状態とaudio sourceが明確。録音中はminimal indicatorが常時見える。
AC-08: Meeting main surfaceはNotes first。Transcriptはon demandで展開。
AC-09: Final meeting summaryのkey claimから該当Transcript/timestampへjumpできる。
AC-10: Research resultはsource count/confidence/contradictionを表示しEvidenceへ掘れる。
AC-11: Library artifactからsource task / meeting / lineageを追跡できる。
AC-12: Plugin/Pack追加後もトップNavigationはHome/Work/Library/Appsの4つから増えない。
AC-13: 1280px以上で3-column workspace、960px台でinspector drawerへreflowする。
AC-14: Light/Dark両方で主要controlsがkeyboard操作可能かつfocus可視。
AC-15: Errorは仕事への影響とnext actionを説明し、勝手に成功扱いしない。

## Appendix A. Component inventory

| Component | Purpose | States |
|---|---|---|
| AstraDock | Universal intent input | ready/listening/typing/working/result |
| ContextChip | compact context source | normal/sensitive/removed |
| ContextLens | context inspector | compact/full |
| WorkCard | semantic progress | active/waiting/done/failed |
| TaskStep | work step | todo/active/done/retrying/failed |
| ApprovalCard | external action confirm | commit/destructive/reg/financial |
| ActionReceipt | executed action record | success/partial/failed/reversed |
| RecordingIndicator | minimal meeting status | recording/paused/degraded |
| MeetingSurface | notes-first meeting UI | live/finalizing/complete |
| TranscriptPanel | speaker transcript | partial/final/translated |
| MarkerButton | important/decision/todo | idle/marked |
| EvidenceSummary | source confidence summary | compact/expanded |
| EvidenceInspector | claim-source provenance | group/claim/source |
| ArtifactCard | library object | normal/shared/sensitive |
| LineagePanel | artifact ancestry | compact/graph |
| AttentionCard | proactive item | info/action-required |
| PackCard | Apps catalog | available/installed/update |
| PermissionSheet | purpose-first permission | connector/OS/plugin |
| GlobalSearch | work+artifact+entity search | idle/results |
| InspectorDrawer | context/evidence/activity | right drawer |

## Appendix B. Wireframes

### B.1 Task Dock → Context → Work

1) READY                     ╭──────────────────────────────╮                     │ ✦ 何をしますか？      [Mic] + │                     ╰──────────────────────────────╯2) INTENT + CONTEXT                     ╭────────────────────────────────────────╮                     │ A社向けにこの提案を直して      [Mic] │                     ├────────────────────────────────────────┤                     │ Q4提案.pptx  A社  明日10:00  +4      │                     ╰────────────────────────────────────────╯3) WORK                     ╭────────────────────────────────────────╮                     │ A社 商談準備                    進行中 │                     │ ✓ 関連情報を確認                       │                     │ ● 競合情報を調査中 · 12 sources       │                     │ ○ 提案資料を更新                       │                     │                         [詳しく見る]   │                     ╰────────────────────────────────────────╯

### B.2 Meeting

● REC 18:42  A社 新規提案  3 speakers   [Pause] [Stop]┌──────────────────────── Notes ────────────────────┬─ Transcript ───────┐│ 価格条件について                                 │ 14:18 田中          ││ ・導入時期10月                                   │ 初期費用が…         ││ ・先方は初期費用を懸念                           │                    ││                                                  │ 14:19 伊藤          ││ + メモ                                           │ 分割なら…           ││ [重要] [決定] [ToDo]               [Ask Astra] │                    │└──────────────────────────────────────────────────┴────────────────────┘

### B.3 Workspace

┌ Sidebar ───┬──────────────────── Main ────────────────────┬ Inspector ┐│ Home       │ A社 商談準備                                      │ Context   ││ Work       │ Overview / Progress / Outputs / Evidence           │ Evidence  ││ Library    │                                                    │ Activity  ││ Apps       │ Executive brief / artifacts / next actions         │           ││            │                                                    │           ││            │ Ask Astra…                                         │           │└────────────┴────────────────────────────────────────────────────┴───────────┘

### Source basis

本仕様は「新AIプラットフォーム 詳細設計仕様書 v0.1」の4タブ固定、Task Dock、Context Engine、Conversation Engine、Research/Evidence、Action Risk Policy、Meeting dual path、Library/Share、Plugin Package、Durable Task Runtimeを前提に、UI/UXの具体化を行った。競合UIの固有挙動は実装要件ではなく、Astraの設計原則に変換して採用している。
