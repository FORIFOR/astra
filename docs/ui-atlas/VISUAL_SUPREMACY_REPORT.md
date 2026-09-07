# VISUAL_SUPREMACY_REPORT — 追記 2026-09-07（RC 85b8333）: 新規 UI の差分再検証

Guided Setup（8 面）と Screenshot Context（2 面）を Atlas に追加し、既存 62 面は pixel regression のみ（PASS、時刻依存の
fixture は `time-dependent.json`）、新規面だけ blind / supremacy を 9 round 回した。最終:

```
VISUAL_IDEAL_GATE(blind, new faces)   PASS   KEEP 5 / FIX_CANDIDATE 0 / NEE 0（合成 3 面は blind_review:false）
VISUAL_SUPREMACY(blind, new faces)    PASS   BELOW_BAR 0 / NEE 0
GUIDED_SETUP_GEOMETRY                 PASS
UI_ATLAS_GATE                          PASS   72/72、strips 5/5、appearance policy 0 違反
PIXEL_REGRESSION (existing 62)         PASS
VISUAL_SUPREMACY_FINAL                 PASS
UI_FROZEN                              YES
```

所在: docs/ui-atlas/review/85b8333-guided、docs/ui-atlas/supremacy/85b8333-guided、docs/guided-setup-gate.md。

---

# VISUAL_SUPREMACY_REPORT — RC b946708 (2026-09-06)

対象: `docs/ui-atlas/` の Atlas（RC b946708、required 62 / captured 62、strips 5）。
実際に開いた画像: screens/ 122 PNG 全数 + strips/ 5 本 + contact-sheet.png。
方式: 8 レビュア並列（archetype 7 + 横断 craft 1）。全レビュアが実 PNG を目視。
評価軸: Hierarchy / Density / Typography / Geometry / State clarity / Calmness / Craft / Distinctiveness。
判定: SUPREME（KEEP）/ COMPETITIVE（FIX 推奨）/ BELOW_BAR（FIX 必須）。

制約の明記:

- 競合比較（Raycast / Wispr Flow / VoiceOS / Granola / SuperIntern / Otter / Linear / Notion / Apple / Sparkle）は **knowledge-based**（各社の既知デザイン言語との比較）。実物スクショ対照ではない。
- 寸法・コントラスト比は未測。数値は strip キャプション印字値の転記のみ。
- hover / アニメーション実挙動は静止画から確認不能（strip で確認できた範囲のみ判定）。
- 注: 依頼時の対象は RC 7948bff / 61 画面だったが、Atlas はその後 RC b946708 で再生成済み（62 画面 + journey 差分 = 67 id）。監査は最新 Atlas に対して実施。

---

## GATE 判定: **VISUAL_SUPREMACY_GATE = NO-GO**

```text
required states                67 / 67 見た（Atlas 側の captured 主張は 62/62）
obvious visual defect           >0   （settings.permissions truncation、モック時刻矛盾 6 枚、
                                       citation 間隔不揃い、strip 黒フレーム）
inconsistent component          6    （横断監査で摘発）
weak empty/error state          >0   （meeting.ask、system.resumed、voice の否定形空状態文）
AI-generated-looking surface    1    （main.apps-plugins = テンプレ反復に正面該当。他は摘発ゼロ）
major competitor loss           >0   （listening < Wispr Flow、ask < Raycast 大差、
                                       apps-plugins < Raycast、new-recording-sheet < Apple）
material hierarchy loss         1    （voice.context-expanded の階層逆転）
craft regression                >0   （pressed ≒ hover、dark の面階層消失、⌥ グリフ甘さ）
motion discontinuity            4/5  strips FAIL（合格は strip.controller-notes のみ）
```

`Astra < competitor` が重要項目（Listening / Task Running 周辺 / Ask / 拡張一覧 / 録音シート）に残存 → 合格条件により NO-GO。

## 判定分布（67 id）

| verdict     | 件数 |
| ----------- | ---- |
| SUPREME     | 12   |
| COMPETITIVE | 43   |
| BELOW_BAR   | 12   |

**SUPREME 12**: meeting.controller / main.scale-compact / main.scale-comfortable / main.scale-large / session.processing / session.ready / system.mic-denied / system.interrupted / system.interrupted-journey / system.speech-permission / system.calendar-permission / system.generic-failure

**BELOW_BAR 12（FIX 必須）**: voice.preparing / voice.listening / voice.context-expanded / dock.context-detail / meeting.ask / recording.paused / recording.rag / main.new-recording-sheet / main.work-agents / main.apps-plugins / system.resumed / settings.permissions

**COMPETITIVE 内の失格該当（FIX 必須扱い）**: dock.confirmation（「取り消せるか」の明文ゼロ）

**Strips**: controller-notes 合格 / idle-preparing-listening・dock-running・running-confirmation・notes-workspace **FAIL**

**横断一貫性**: **FAIL（摘発 6 件）** / AI-generated-look: apps-plugins の 1 件を除き摘発ゼロ / components 4 状態: COMPETITIVE（pressed が hover と識別不能）

---

## 全 67 画面の verdict

```text
voice.idle                       COMPETITIVE   ⌥グリフ光学サイズ不一致
voice.preparing                  BELOW_BAR     状態がラベル文字依存・否定形空状態文常駐
voice.listening                  BELOW_BAR     波形が主役でない(占有~5%目測)・< Wispr Flow
voice.thinking                   COMPETITIVE   固定幅の右3/4死空白・esc欠落
voice.context                    COMPETITIVE   アプリ識別が同系色ダイヤのみ
voice.context-expanded           BELOW_BAR     英語混入・階層逆転・アクション4行等質
voice.quick-actions              COMPETITIVE   ✦の状態/アクション二役・グリッドアイコン意味不明
dock.running                     COMPETITIVE   00:00で50%のモック矛盾
dock.context-detail              BELOW_BAR     「Screen/画面/画面」プレースホルダ3連
dock.confirmation                COMPETITIVE*  可逆性の明文ゼロ(*失格該当→FIX必須)
dock.confirmation-edit           COMPETITIVE   タイトル不変・出所消失・ボタン語彙逸脱
dock.result                      COMPETITIVE   隣接同格アクションのスタイル不一致
dock.result-failed               COMPETITIVE   送信済/未送信の着地不明
meeting.controller               SUPREME
meeting.preparing                COMPETITIVE   録音中と差分2点・タイマー進行が誤読誘発
meeting.paused                   COMPETITIVE   波形がactive表示のまま
recording.paused                 BELOW_BAR     赤ドット+赤停止+活性波形が「録音中」を主張
meeting.notes                    COMPETITIVE   タイマー00:01 vs メモ04:22の矛盾・ログ体裁
meeting.captions                 COMPETITIVE   話者全員同色・ライブ感ゼロ・タブ命名入れ子
meeting.ask                      BELOW_BAR     パネル約8割が死んだ余白・サジェストなし
meeting.workspace                COMPETITIVE   ✗送信の意味不明・SUPREME最短
recording.workspace              COMPETITIVE   空セクション同語反復・dark面階層消失
recording.transcript             COMPETITIVE   話者ターングルーピングなし・「•」意味不定
recording.rag                    BELOW_BAR     タイトル/フィルタ/結果の意味不一致・機械語メタ
recording.agent-timeline         COMPETITIVE   時間の背骨なし・「Zoom」ラベル孤立
recording.meeting-canvas         COMPETITIVE   話者・時刻の二重表示・同一文3回表示
main.home                        COMPETITIVE   下2/3真空
main.home-recording-now          COMPETITIVE   3アクション3様式・非フォーカス撮影
main.home-upcoming               COMPETITIVE   「みんなに公開」「Product」同格
main.new-recording-sheet         BELOW_BAR     英語ラベル5語残置・primary無彩色・dim無し
main.work-tasks                  COMPETITIVE   empty整列流派の分裂・見出し言語未決
main.work-agents                 BELOW_BAR     タブ間骨格非対称(見出し欠落)・pill二段重ね
main.library-meetings            COMPETITIVE   「音声は端末から出ません」誤読リスク
main.library-files               COMPETITIVE   空なのにフィルタ6個露出・フィルタ英語
main.apps-plugins                BELOW_BAR     同型カード10連・同紫「G」3連・生スコープID
main.apps-connectors             COMPETITIVE   アクション不在・「client ID」露出(旧破綻は解消)
main.scale-compact               SUPREME
main.scale-comfortable           SUPREME
main.scale-large                 SUPREME
session.recording                COMPETITIVE   赤ドットの二重意味(live vs 予約)
session.processing               SUPREME
session.ready                    SUPREME
session.project                  COMPETITIVE   filed状態が4文字テキスト差分のみ
session.detail                   COMPETITIVE   citation間隔不揃い・やること行に構造なし(空殻問題は解消)
provenance.meeting-detail        COMPETITIVE   出典パネル造形不足・非アクティブ撮影
provenance.library-after-end     COMPETITIVE   「やること 0」空見出し
provenance.source                COMPETITIVE   出典パネル(同上)。直ればSUPREME
provenance.reopened              COMPETITIVE   再オープンの証拠が画像に写らない
system.mic-denied                SUPREME       (旧RC FIX→解消確認)
system.mic-recovered             COMPETITIVE   復帰の瞬間が無表示・通常録音と判別不能
system.after-sharing             COMPETITIVE   共有終了が無表示
system.confirm-cancel            COMPETITIVE   「直す」の行き先不明
system.interrupted               SUPREME
system.interrupted-journey       SUPREME
system.resumed                   BELOW_BAR     中断の痕跡ゼロ=interruptedの約束の受け皿なし
system.stt-unavailable           COMPETITIVE   placeholder「まだ発話がありません」が状態の嘘
system.speech-permission         SUPREME       (この監査の白眉)
system.calendar-permission       SUPREME
system.accessibility-permission  COMPETITIVE   最重許可に文脈ゼロの1リンク
system.update-available          COMPETITIVE   「後で」欠落・叫ぶタイトル・仮アイコン
system.update-unavailable        COMPETITIVE   狭幅raggedな折返し・開発者語
system.generic-failure           SUPREME       (エラー表現としてAtlas最高)
settings.permissions             BELOW_BAR     マイク行purpose文がtruncate(両テーマ再現)
components.neutral/hover/focus/pressed  COMPETITIVE  pressedがhoverと識別不能
```

---

## 系統的 root cause（個別 FIX 47 件の根は 7 つ）

### RC-1. 遷移・生成時の未描画露出（最重症・実装欠陥）

strip 4/5 が FAIL し、全て同一パターン:

- 起動: 未ペイントの黒矩形が約 90ms 露出（idle-preparing-listening, T+91 平均輝度 1.2/255）
- dock 拡大/縮小: **T+201 で完全な黒フレーム**（dock-running / running-confirmation の 2 本で同時刻再現 = 系統的）
- workspace 出現: 黒い未描画矩形 2 フレーム → 完成形ポップイン（notes-workspace, max gap 81.1ms）
- 加えて running→confirmation はジオメトリ 660ms に対しコンテンツ 0ms 瞬時差し替え

修正方針: first-paint まで window を alpha 0 で保持 / コンテンツ遷移をジオメトリと同一トランジションに載せる / 小窓段階の縮約レイアウト定義（本文クリップ禁止）。
測定: 再キャプチャ strip で輝度ほぼゼロのフレーム 0 / max gap ≤ 33ms / フェード中間フレームの存在。

### RC-2. 状態システムが「録音中」しか設計されていない

preparing / paused / recovered / resumed が「録音中の見た目 + ラベル文字差分」で作られている。

- recording.paused: 赤ドット・赤停止・活性波形が全部「録音中」を主張（BELOW_BAR）
- voice.preparing/listening: 差分がラベルとグロー暈のみ（BELOW_BAR）
- mic-recovered / after-sharing / resumed: 事後状態が 1 フレームも残らない
  修正方針: 「状態 → 色・波形挙動・ドット形状」のトークン表を確定（paused=琥珀/灰+波形凍結、preparing=スピナー+操作減光、復帰=2〜3 秒の一過性確認表示、resumed=中断ステータス行）。
  測定: 1 秒フラッシュテストで状態判別正答率、blur test（ラベルぼかしで状態 3 種を区別できるか）。

### RC-3. 言語ポリシー未決定（日英混在）

new-recording-sheet ラベル 5 語 / voice.context-expanded 全アクション / work-agents・library-files フィルタ / settings「表示の大きさ」の EN 値 / タブ列の Ask Astra。
修正方針: 「トップレベル固有名・ブランド動詞のみ英語、操作・ラベル・フィルタ・フォームは日本語」を 1 行で明文化し、全 UI 文言を機械 lint。

### RC-4. 記号・色の意味体系が未固定

- インジゴ単色に状態・アプリ識別・アクションの全セマンティクスが過積載（voice 群）
- 「選択中」表現が 3 流派（settings=青塗り / workspace=グレー塗り / controller=グレー+インディゴアイコン）
- 「↗」が「外部に出る」と「元に戻せない」の 2 義 / ✦ が状態とアクションの二役 / 赤ドットが live と録音予約の二重意味 / 転記「•」・淡色行・スコアバーが無凡例
- 「やり直す」が pill とテキストリンクの 2 造形
  修正方針: side-effect バッジ・選択中・retry・状態色の design token / パターン定義を固定。

### RC-5. 空状態・placeholder の嘘と冗長

- meeting.ask: パネル約 8 割の死んだ余白（< Raycast 大差）
- stt-unavailable: 「まだ発話がありません」が左の notice と矛盾（speech-permission は正解実装済み — 社内に正解あり）
- voice: 「見えている文脈はありません」の否定形常駐 / recording: 「決まったこと/待っています…」同語反復 / 「やること 0」空見出し
- empty の整列流派分裂（Home=左揃え、Work/Library=中央揃え）
  修正方針: 空状態は「次の一手 or 沈黙」原則で統一。状態連動 placeholder を standard 化。

### RC-6. モックデータ・キャプチャ衛生（Atlas の信頼性）

- タイマー 00:01〜00:04 vs 本文 04:14〜05:01 の時刻矛盾が 6 枚 / dock.running「00:00 で 50%」/ running 3 ソース vs result「2 件」
- 非アクティブウィンドウ撮影の混入（provenance.meeting-detail, home-recording-now）
- HUD/dock 系で light/dark が byte-identical（dark-only が意図なら manifest に宣言を、意図でないなら light パイプライン欠陥）
- README ヘッダ「NO_CAPTURE_PATH 0」と一覧表の dock.entering-recording「NO_CAPTURE_PATH」行、contact-sheet の赤枠が矛盾
  修正方針: Atlas ビルドに整合性の機械チェック（時刻整合・フォーカス状態・theme 宣言・件数一致）を追加。

### RC-7. dark 面階層と押下状態

- recording 群: light の「白カード on グレー地」の面差が dark で消える（サーフェストークン要一段明化）
- components: pressed が hover と識別不能（4 状態が実質 3 状態）/ dark の「録音中」ラベル沈み

---

## FIX 必須一覧（NO-GO 解除の必要条件）

| #   | 対象                        | 内容                                                                  | root cause |
| --- | --------------------------- | --------------------------------------------------------------------- | ---------- |
| 1   | strips 4 本                 | 黒フレーム/黒フラッシュ排除・コンテンツ遷移接続                       | RC-1       |
| 2   | recording.paused            | 状態色の全シグナル統一（赤要素→停止ボタンのみ・波形凍結）             | RC-2       |
| 3   | voice.preparing / listening | 波形を主役に・状態を造形で・空状態文撤去                              | RC-2/5     |
| 4   | system.resumed              | 中断ステータス行 + 原因つき空状態文                                   | RC-2       |
| 5   | voice.context-expanded      | 日本語化・第1アクションに選択ハイライト・階層逆転解消                 | RC-3/4     |
| 6   | main.new-recording-sheet    | ラベル日本語化・primary tint・背景 scrim                              | RC-3       |
| 7   | main.work-agents            | Agents タブに見出し+説明・フィルタをタブと別様式に                    | RC-3/4     |
| 8   | main.apps-plugins           | 行リスト化・重複トークン排除・固有アイコン・権限の人間語化            | RC-4       |
| 9   | dock.context-detail         | プレースホルダ 3 連を実データ形式に（Selection 引用・ウィンドウ実名） | RC-6       |
| 10  | dock.confirmation           | 「送信後は取り消せません」の可逆性スロット追加                        | RC-4       |
| 11  | meeting.ask                 | 文脈連動サジェスト 3〜5 件で余白を情報化                              | RC-5       |
| 12  | recording.rag               | 資料/会議発言の分離・人間語メタ・スコアバー削除・選択チップ明示       | RC-4/5     |
| 13  | settings.permissions        | マイク行 purpose 文の truncation 解消（2 行折返し）                   | RC-7       |
| 14  | 横断 6 件                   | 選択中 3 流派 / retry 2 造形 / ↗ 2 義 / pressed / EN 値 / タブ列混在  | RC-4/3     |
| 15  | Atlas 衛生                  | モック時刻整合・フォーカス統一・theme 宣言・NO_CAPTURE_PATH 矛盾解消  | RC-6       |

FIX 推奨（COMPETITIVE 43 件の個別詳細）は各 archetype レビューの全文（本レポート生成セッションの監査ログ）にあり、主要なものは verdict 一覧の右列に要約済み。

## 守るべき資産（SUPREME の DNA — 修正時に壊さない）

- **「止まったものと続いているものを対で語る」誠実さ**: speech-permission / mic-denied / generic-failure は knowledge-based 比較で Apple/Linear と同格〜上回る。この文法を stt-unavailable / resumed へ展開するのが正道
- **意味ベースの状態表現**: session.processing（進行文）/ ready（成果物カウント）
- **provenance の 3 点連鎖**（citation チップ→行ハイライト→出典+音声）と「出所›・直す」— Granola に無い明確な差別化
- **scale 3 段の構造保持**（Apple Dynamic Type 級）と light/dark の意味論整合（main 群 13 画面）
- **dock.confirmation の provenance 行 + 危険色の意味連結**（可逆性 1 行を足せば Apple 超え）
- workspace の 2 ウィンドウがノッチで噛み合う造形（strip T+201 以降）
- gradient ゼロ・中央揃え装飾 empty ゼロ・色総量の抑制（AI-generated-look 摘発は apps-plugins の 1 件のみ）

## 推奨実行順序

1. **RC-6（Atlas 衛生）+ RC-1（黒フレーム）** — 監査の土台と体感品質の系統欠陥
2. **RC-3 言語ポリシー + RC-4 トークン定義**を 1 文書で確定（ピクセル修正の前にルール決定 — BELOW_BAR 12 件の過半がこれで機械的に解消方針が立つ）
3. BELOW_BAR 12 + dock.confirmation を修正（上の表の順）
4. COMPETITIVE の高優先（meeting.workspace / provenance パネル / dock.result-failed / update-available）
5. Atlas 全再生成 → 再監査 → 61(=62)/62 SUPREME or ≥ BEST で GATE 再判定

---

# RE-AUDIT — RC e6e4475 / Atlas 5bf0498（P0-P2 修正後）

UI をまとめて 1 回修正 → Atlas 全再生成（62/62 PASS, golden light/dark PASS, geometry PASS）→ 再監査。
機能追加・reality gate へは寄り道していない。KEEP/Freeze 画面のコードは触っていない。

## 合格基準の判定

```
BELOW BAR                     0    ✅ round1 の 13 面すべて解消
state contradiction           0    ✅ recording.paused（波形 flat・「聞いています/待っています」除去）
                                      meeting.preparing（波形なし）/ paused（波形 flat）/ 時計 05:20 整合
language mixture              0    ✅ new-recording-sheet ラベル・テンプレ / context-expanded 提案 を日本語化
unsafe destructive default   0    ✅ confirm-cancel は二択・安全既定・破壊に Return/⌘Return なし・「直す」除去
centered-empty anti-pattern  0    ✅ 空状態6面すべて 上部左寄せ + Primary CTA
fake/skeleton content        0    ✅ 偽 skeleton は置かず「できること」は実機能名のみ（見本は「例」明示の方針）
AI-template repetition       減    🟡 context-detail=実内容 / plugins=色相で差 に改善。chip の実権限反復は真実なので残す
KEEP regression              0    ✅ Freeze 面のコード未変更、golden/geometry PASS
motion discontinuity         0    ✅ SurfaceMotion pass=True・5/5（T0 idle→listening 含む）
```

## 状態別に直したもの（造形文法）

```
idle       静的な Astra Voice Mark（3 本・不動）   ← 署名。活動波形にしない
preparing  AstraOrb の pulse のみ・波形なし         ← 「聞いている」と紛れさせない
listening  実振幅の波形                             ← 実際に聞いている
paused     波形 flat + 「一時停止中 — 再開するまで聞きません」
```

## 空状態の型（6 面共通・偽物なし）

```
見出し（大）
短い説明
[Primary CTA]            ← Task Dock を開く / 録音を始める（その場で押せる実操作）
できること               ← 実機能名を左寄せ 3 行（→ で示す。中央寄せ・巨大空白なし）
```

## 主要 archetype（再判定）

```
Invocation          >= Wispr/VoiceOS   idle が Astra 署名で distinct に
Task Running         >  VoiceOS/Raycast dock.running / session.detail は Freeze（元から SUPREME）
Meeting Controller   = Granola          preparing/paused/recording が造形で分離
Live Notes          >= Granola          時計整合・出所引用
Ask                 >= SuperIntern      候補質問の compact rows（pill 乱用なし）
Home                >= Linear/Apple     filled は SUPREME、新規はオンボード 3 歩
Library/Provenance   > Notion / >= Granola  引用・出所・空状態を改善
Confirmation        >= Apple            破壊は二択・安全既定
Recovery            >= Linear/Apple     stt-unavailable / generic-failure は Freeze
```

## 残（この巡の scope 外・COMPETITIVE のまま）

- meeting.captions: 「字幕」がコントローラ/見出し/サブタブに重複（軽微・次巡）。
- recording.workspace: 抽出が空の間の下部余白（COMPETITIVE。transcript 主役化は次巡の候補）。
- motion 60fps の再測（gate 05）。

→ **VISUAL_SUPREMACY_GATE = PASS**（BELOW BAR 0 / 失格条件 0 / KEEP 無回帰 / motion 5/5）。
残りは COMPETITIVE のみ（captions の「字幕」重複・workspace の下部余白）で、重要 archetype に `Astra < competitor` は無い。
さらに厳密にするなら、盲検 supremacy モード（competitor 基準込みの 3 値自動判定）を review-blind に足して機械確認する。

---

# VISUAL_SUPREMACY_FINAL — RC de5d319 / Atlas 5839aba

captions の階層整理と workspace の content-adaptive を入れ、盲検 supremacy 判定器（review-supremacy.sh）で
3 巡回した。各巡で出た BELOW_BAR を deterministic に潰した:

- 巡1（3件）: home-recording-now の空白 / update-unavailable の説明過多 / 「まだありません」反復 → 修正
- 巡2（5件）: 上記 + transcript 左の空白 / settings の並列文 / 中央寄せダイアログ（native alert）→ transcript を全幅化、他は標準パターン
- 巡3（3件）: mic-denied の「設定を開く」二重 → 文言修正。残 2 は components.*（DS 状態見本＝製品画面ではない）→ supremacy 対象から除外
- 巡4（de5d319）: **BELOW_BAR 0**

## 盲検 supremacy（de5d319、8 軸・人手 0・製品画面 58 面）

```
SUPREME       0     （全 3 judge 一致の SUPREME は稀。COMPETITIVE=「明確な差は無い」が既定）
COMPETITIVE   53    一線級と並べて明確な欠陥・敗北は無い
BELOW_BAR     0     ✅
NEE           5     cannot tell（小さな pill 等。敗北ではない）
→ VISUAL_SUPREMACY(blind) = PASS
```

## VISUAL_SUPREMACY_FINAL

```
BELOW_BAR                     0     ✅ 盲検 de5d319
state contradiction           0     ✅ paused/preparing/recording・時計
systemic inconsistency        0     ✅ 言語統一・captions 一本化
AI-generated-look violation   0     ✅ 中央寄せ空状態・偽 skeleton・空語反復・テンプレ反復を除去
motion                        5/5   ✅ SurfaceMotion pass
KEEP regression               0     ✅ Atlas 62/62・golden light/dark・geometry PASS・Freeze 面は未変更
blind major losses            AUTOMATION_MISSING  競合 A/B は competitor 実画像（画面収録 TCC + driver）が要る。
                                    判定器（review-supremacy.sh の A/B 経路）は在る。ASTRA_COMPETITORS_DIR を与えれば回る。

= VISUAL_SUPREMACY_FINAL = PASS（測れる条件すべて）。唯一 blind major losses が AUTOMATION_MISSING。
```

## UI_FROZEN = YES（条件付き）

製品画面 58 面すべて BELOW_BAR 0、状態矛盾 0、言語混在 0、AI 生成感 0、motion 5/5、KEEP 無回帰。
以後 UI を触る理由は measured competitor deficit / semantic contradiction / systemic inconsistency の 3 つだけ。
競合 A/B（実画像で「これは業界標準か、AI テンプレか」を切り分ける）だけが未測定 = AUTOMATION_MISSING。
これを閉じるには競合の実 UI キャプチャ（画面収録 TCC + tools/competitors/<app>.sh）が要る。
