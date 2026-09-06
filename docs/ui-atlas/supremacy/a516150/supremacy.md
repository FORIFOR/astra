# Blind supremacy review — RC a516150（8 軸・自己採点・人手 0）

SUPREME 0 / COMPETITIVE 53 / BELOW_BAR 5 / NEE 4 → VISUAL_SUPREMACY(blind)=FAIL

BELOW_BAR は「有効 judge 全員が BELOW_BAR」。1 人の趣味では落とさない。A/B 競合比較は competitor 画像が要る（AUTOMATION_MISSING）。

| id | verdict | judges | avg(craft/dist/hier) | ai_look |
|---|---|---|---|---|
| `main.work-tasks` | COMPETITIVE | haiku:COMP opus:BELO sonnet:COMP | 3.67/3/3.67 | 同じ内容を言い直す説明文の二重化（見出し直下の説明＋空状態の説明）; 説明文の反復（似た文を2箇所で言い直す空語気味の冗長さ） |
| `system.mic-recovered` | COMPETITIVE | haiku:COMP opus:BELO× sonnet:COMP | 4/3/3.5 |  |
| `system.generic-failure` | COMPETITIVE | haiku:COMP opus:COMP sonnet:COMP | 4/3/4.33 | カードの角丸と高さが全行ほぼ同一で、重要度差が形に現れていない; 同一画面に「録音を始める」導線を3種類重複配置する網羅志向 |
| `provenance.meeting-detail` | COMPETITIVE | haiku:COMP opus:COMP sonnet:COMP | 4/4.33/4.67 | 右サイドパネルが内容量に対して余白過多で、可変幅でなく固定パネルを敷いただけに見える |
| `meeting.workspace` | COMPETITIVE | haiku:COMP opus:BELO sonnet:BELO | 3.33/3.67/3.67 | Real-time AI categorization (Decided/Actions/Questions/Concerns) may leverage AI summaries, adding distinctive but somew |
| `settings.permissions` | BELOW_BAR | haiku:BELO opus:BELO sonnet:BELO | 3/2.33/4 | Explanatory text shows clear signs of AI generation or poor machine translation — awkward phrasing, grammatical errors,  |
| `recording.rag` | COMPETITIVE | haiku:COMP opus:COMP sonnet:COMP | 3.67/3.33/4 | 根拠バーが数値も凡例もない装飾的スコア表示になっている; ラベルの無い謎の色付きメーター(資料パネル右端の横棒)が装飾的パディングに見える |
| `provenance.library-after-end` | COMPETITIVE | haiku:COMP opus:BELO× sonnet:COMP | 4/3/4.5 |  |
| `main.new-recording-sheet` | COMPETITIVE | haiku:COMP opus:BELO sonnet:COMP | 3.33/3/3.67 | ネイティブ風セレクトと独自ボタンの混在で、系統が揃っていない |
| `dock.running` | COMPETITIVE | haiku:COMP opus:COMP sonnet:COMP | 4.33/4/4.33 |  |
| `system.calendar-permission` | COMPETITIVE | haiku:COMP opus:COMP sonnet:COMP | 3.67/3/4 | 「はじめに」で機能を 3 行そのまま説明する説明過多の空状態; 矢印(↳)付き箇条書きのオンボーディングTipsが後の画像(5214)の『できること』とほぼ同一パターンで使い回されており、テンプレート反復に見える |
| `main.work-agents` | COMPETITIVE | haiku:COMP opus:BELO sonnet:COMP | 3.67/2.33/3.33 | 中央寄せではないものの、空状態＋主ボタン＋「できること」3 行という定型の反復（51ED とほぼ同じ型）; 中央寄せ見出し+説明文+単一CTA+矢印箇条書きTipsという構成が51EDの空状態と同型で、アプリ内で空状態テンプレートが反復され |
| `meeting.ask` | COMPETITIVE | haiku:COMP opus:COMP sonnet:COMP | 3.67/2.67/4 | 「よく聞くこと」の下に矢印付きの定型質問を 3 行並べる構成は、AI 機能の空状態テンプレとして頻出; 矢印(↳)付き提案リストは他製品にも頻出するテンプレ的パターン |
| `system.resumed` | COMPETITIVE | haiku:COMP opus:BELO sonnet:BELO | 2.67/2/3.33 | 「決まったこと 0 / やること 0」の表示が単調。タイポグラフィのバリエーションで数値と分類を区別しているが、視覚的には平坦; 同じ見出しを 2 段（ウィンドウバーと本文）に反復するテンプレ構造; 内容量に対してレイアウトが追従せず、下部 |
| `system.speech-permission` | COMPETITIVE | haiku:COMP× opus:COMP sonnet:COMP | 4/3.5/4 | 警告バーと空状態で同じ説明を繰り返す説明過多 |
| `main.library-files` | COMPETITIVE | haiku:COMP opus:BELO sonnet:BELO | 3.67/2.67/4.33 | 『できること』リストがやや説明過多。一行目『会議の要約やレポートが成果物として残る』は冗長。ただし、ユーザー教育の観点では機能している; 空状態に「できること」を矢印付き 3 行で並べる定型（54ED と同じ型の反復）; 「できること」の矢 |
| `voice.context` | COMPETITIVE | haiku:NOT_ opus:NOT_ sonnet:COMP | 2/1.33/2 | 紫のひし形アイコンという汎用的な連携ソース表現 |
| `components.neutral` | COMPETITIVE | haiku:COMP opus:COMP sonnet:COMP | 4/3/4.67 | 『AI が見ている資料 3 件』は説明的だが、『見ている』という表現が若干曖昧。件数を数値で示すだけでよく、冗長な感がある |
| `voice.quick-actions` | COMPETITIVE | haiku:NOT_ opus:BELO sonnet:COMP | 3/2.33/2.33 | 動詞 3 つを等価に並べただけのテンプレ構成; アイコン+ラベルを横並びで等間隔反復しただけの汎用ピル |
| `components.pressed` | COMPETITIVE | haiku:COMP opus:COMP sonnet:COMP | 3.67/3/4 | floating AI feature button at bottom reads as an addition rather than thoughtfully integrated; 下部の「要約 / 決まったこと / やること」pi |
| `meeting.captions` | COMPETITIVE | haiku:COMP opus:COMP sonnet:COMP | 3.67/3/3.67 | Dark mode + feature-adding design pattern suggests modern AI-assisted tool rather than core Google design; タブ行が二段重ねでテンプレ |
| `dock.confirmation-edit` | COMPETITIVE | haiku:SUPR opus:BELO sonnet:BELO | 3.67/3.33/4 | 和語に言い換えた結果、動作が曖昧になったボタン文言（「直し終える」）; ダイアログの問いとボタン文言が呼応しておらず、コピーが最後まで整合されていないAI組立て特有の粗さ |
| `components.focus` | BELOW_BAR | haiku:BELO opus:BELO sonnet:BELO | 2.33/2.67/2.67 | multiple simultaneous focus outlines read as UI kit demonstration; 全操作要素へ一律に同じ強調を付ける機械的な処理; 全インタラクティブ要素のヒットボックスを一括表示したよう |
| `session.detail` | COMPETITIVE | haiku:SUPR opus:COMP sonnet:COMP | 4.33/3.67/5 | サイドバーが Home / Work / Library / Apps という汎用テンプレ名詞の羅列 |
| `meeting.preparing` | COMPETITIVE | opus:BELO sonnet:COMP | 3.5/3/3.5 | 「準備中…」という状態語が具体的な進捗を何も伝えていない |
| `main.home` | COMPETITIVE | opus:BELO sonnet:COMP | 3.5/3/3.5 | 「はじめに」3 行が説明過多で、機能の言い換えに近い; 矢印付きの3行オンボーディングTipsが均一なテンプレート感を持つ |
| `system.after-sharing` | NOT_ENOUGH_EVIDENCE | opus:COMP× sonnet:COMP | 4/3/4 |  |
| `system.update-unavailable` | BELOW_BAR | opus:BELO sonnet:BELO | 2/2/3.5 | 中央寄せ・アイコン・見出し・説明・2ボタンという既製ダイアログのテンプレそのまま; 汎用グリッドアイコンが未完成/デフォルト画像のまま出荷されたような印象を与える |
| `voice.listening` | NOT_ENOUGH_EVIDENCE | opus:COMP× sonnet:COMP× | -/-/- |  |
| `voice.idle` | COMPETITIVE | opus:NOT_ sonnet:COMP | 4/3/3 |  |
| `dock.result-failed` | NOT_ENOUGH_EVIDENCE | haiku:COMP× opus:COMP× sonnet:BELO | 2/2/3 |  |
| `session.ready` | COMPETITIVE | haiku:COMP opus:BELO sonnet:COMP | 3.67/3/3.67 | 情報整理が完璧すぎて、やや「テンプレート感」がある; 挨拶大見出し＋検索風プレースホルダ（「何を終わらせますか？」）という定番ホームの型 |
| `dock.context-detail` | COMPETITIVE | haiku:COMP opus:COMP sonnet:COMP | 3.67/4/4 |  |
| `system.confirm-cancel` | COMPETITIVE | haiku:BELO× opus:COMP sonnet:SUPR | 4.5/3.5/4.5 |  |
| `meeting.notes` | COMPETITIVE | haiku:SUPR opus:COMP sonnet:COMP | 4/4.33/4.67 |  |
| `main.apps-connectors` | COMPETITIVE | haiku:COMP opus:BELO sonnet:BELO | 2.33/2.33/3.67 | 句読点の不自然さ（AI テキスト生成の可能性）; 3 枚の同一角丸・同一影カードを機械的に横並びしただけのテンプレ反復 |
| `meeting.controller` | COMPETITIVE | haiku:COMP opus:COMP sonnet:COMP | 3.67/3/4 | 「Ask Astra」のキラキラ（✨）アイコンは AI 機能の定番表現で、やや既視感がある |
| `dock.confirmation` | COMPETITIVE | haiku:COMP opus:COMP sonnet:BELO | 3.67/3/4.33 |  |
| `main.home-upcoming` | BELOW_BAR | haiku:BELO opus:BELO sonnet:BELO | 3.33/2.67/4 | 中央寄せ・余白を多用した空状態の表現; 「何を終わらせますか？」という汎用プロンプト入力欄をホーム最上段に置く構図はAI製品のテンプレ反復 |
| `session.recording` | COMPETITIVE | haiku:COMP opus:BELO sonnet:COMP | 3.33/3/4.33 | 録音中カードの構成（バッジ＋タイトル＋波形＋停止）は定型で、赤面塗り以外に固有の判断が見えない |
| `recording.meeting-canvas` | COMPETITIVE | haiku:SUPR opus:BELO sonnet:COMP | 3.67/3.67/4 | 決まったこと／やること／質問／懸念 という4分類の機械的な反復。各ブロックが同じ形・同じ行数で、内容の重みの差が形に出ていない |
| `meeting.paused` | COMPETITIVE | haiku:COMP opus:COMP sonnet:COMP | 3.67/3/4 |  |
| `dock.result` | COMPETITIVE | haiku:COMP opus:COMP sonnet:COMP | 3.67/3/4 | 「2 件のソースから作成しました」という、結果そのものより手続きを説明する副文; ダークカード+緑チェックの完了トーストは類似AIツールで頻出するパターン |
| `voice.preparing` | NOT_ENOUGH_EVIDENCE | haiku:COMP× opus:COMP× sonnet:COMP× | -/-/- |  |
| `provenance.reopened` | COMPETITIVE | haiku:COMP opus:BELO sonnet:COMP | 3.67/3.33/4.33 | 「やること 0」のように、中身が無くてもセクションを機械的に3つ並べるテンプレ反復 |
| `main.apps-plugins` | COMPETITIVE | haiku:COMP opus:BELO sonnet:COMP | 3.67/2.67/3.67 | template repetition—every card identical structure (initial letter, name, version, permissions, checkmark); 全カードが同一角丸・同一 |
| `system.mic-denied` | COMPETITIVE | haiku:COMP opus:COMP sonnet:BELO | 3.67/3/4 | 空領域が3か所（左カード・右枠・最下部）で「まだありません」を繰り返しており、同じ空語が反復している; 空状態メッセージ「まだありません」の反復 |
| `voice.thinking` | COMPETITIVE | haiku:COMP opus:BELO sonnet:COMP | 3.33/2/3.67 | きらめき（スパークル）アイコン＋「考えています...」という、AI 製品の最も定型的な待機表現; スパークルアイコン+「考えています...」は生成AIツールの定番ローディング表現 |
| `session.processing` | COMPETITIVE | haiku:COMP opus:COMP sonnet:COMP | 4.33/3/4.33 | カードが全部同じ角丸・同じ白・同じ影で、予定と履歴という性質の違う情報が同じ器に入っている; 全カードが同じ角丸・同じ余白で反復 |
| `session.project` | COMPETITIVE | haiku:COMP opus:COMP sonnet:COMP | 4.33/3/4.33 | 「5 人 / やること 3 / 決まったこと 2」の等間隔アイコン＋数字の並びが、指標を並べただけのテンプレに見える; 同じpill/タグ表現の反復 |
| `system.update-available` | COMPETITIVE | haiku:COMP opus:COMP sonnet:BELO | 3.67/2.33/4 | 「！」付きの宣伝調タイトルと、その直後に同じ内容を繰り返す本文; 変更理由まで説明する冗長な変更履歴の文体がAI生成的 |
| `components.hover` | COMPETITIVE | haiku:COMP opus:BELO sonnet:COMP | 4/3.33/4 | 「要約 / 決まったこと / やること」の等幅ボタン三連が定型のAI操作セットに見える; 最新発言を二重表示する構成が意図的というより埋め草的 |
| `system.stt-unavailable` | COMPETITIVE | haiku:COMP opus:BELO sonnet:COMP | 3.67/3.33/4 | 空状態でも三連ボタンとタブ列をそのまま並べ、淡くしただけで済ませている; 異なる状態のはずのモックで経過時間が完全一致しており、テンプレートで組んだ疑いがある |
| `system.interrupted` | COMPETITIVE | haiku:COMP opus:COMP sonnet:BELO | 4/3.33/4.33 | 失敗カードも成功カードもまったく同じ角丸・同じ白の器で、深刻さの差が色1点でしか出ていない; 空値をそのままラベル表示する「プロジェクト無し」はAI生成UIにありがちな未処理の空状態 |
| `recording.agent-timeline` | COMPETITIVE | haiku:COMP opus:COMP sonnet:COMP | 3.67/3.33/4 | 『会話を用意する / 文字起こしを読む / 答えをまとめる』という 3 段チェックリストが、実際の進捗というより演出的な段階表示に見える |
| `system.accessibility-permission` | COMPETITIVE | haiku:COMP opus:BELO sonnet:COMP | 3.67/3/3.67 | center-aligned empty state with generous whitespace; standard pattern; 『はじめに』の説明 3 行が体言止めの定型反復で、製品説明文がそのまま UI に残っている; 矢印 |
| `voice.context-expanded` | COMPETITIVE | haiku:SUPR opus:COMP sonnet:NOT_ | 4/3.33/4.33 | 同一アイコンの 4 行反復というテンプレ的な提案リスト |
| `provenance.source` | COMPETITIVE | haiku:COMP opus:COMP sonnet:SUPR | 4.67/3.67/5 | 『決まったこと / やること / メモ』の定型 3 分割 |
| `main.library-meetings` | COMPETITIVE | haiku:COMP opus:BELO sonnet:COMP | 3.67/2.33/3.33 | center-aligned empty state pattern; standard capability list + CTA layout; 別画面と同型の『はじめに / できること』3 行リストの使い回し; 矢印付き3項目の「でき |
| `main.home-recording-now` | COMPETITIVE | haiku:COMP opus:COMP sonnet:COMP | 4/3.67/4.67 | card-based layout with slight generic UI feel; meeting cards follow common pattern; 各カード下段の『人数 / やること / 決まったこと』アイコン付きメタ行 |
| `recording.transcript` | BELOW_BAR | haiku:COMP× opus:BELO sonnet:BELO | 3/2.5/4 | 左ペイン下部が「まだありません」一行だけで巨大な空白として残る、典型的な埋まらない空状態; 浮遊ピル型ツールバーが本体と間延びして浮いている(意味のない余白) |
| `recording.workspace` | COMPETITIVE | haiku:NOT_× opus:BELO sonnet:COMP | 3/2/4 | 画面の 7 割が空白なのに、その空白に何も語らせていない（「まだありません」の薄いグレー一行だけ）; 浮遊ピル型ツールバーの間延びした配置 |
