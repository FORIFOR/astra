# Blind supremacy review — RC c531deb（8 軸・自己採点・人手 0）

SUPREME 0 / COMPETITIVE 56 / BELOW_BAR 3 / NEE 3 → VISUAL_SUPREMACY(blind)=FAIL

BELOW_BAR は「有効 judge 全員が BELOW_BAR」。1 人の趣味では落とさない。A/B 競合比較は competitor 画像が要る（AUTOMATION_MISSING）。

| id | verdict | judges | avg(craft/dist/hier) | ai_look |
|---|---|---|---|---|
| `recording.rag` | COMPETITIVE | haiku:BELO opus:COMP× sonnet:COMP | 3/2.5/3 | 4つの視覚的コンポーネント（ヘッダー、左パネル、タブビュー、下部パネル）が無理に組み合わされている; 凡例のない装飾的な関連度バー |
| `voice.listening` | NOT_ENOUGH_EVIDENCE | haiku:SUPR× opus:COMP× sonnet:COMP× | -/-/- |  |
| `voice.thinking` | COMPETITIVE | haiku:SUPR opus:BELO sonnet:COMP | 3.67/2.67/4.33 | 「考えています...」という空語一語だけで画面を成立させている; キラキラアイコン+「考えています…」はChatGPT/Copilot等で使い古された定型AI表現 |
| `main.home-recording-now` | BELOW_BAR | haiku:BELO opus:BELO sonnet:BELO | 2.33/2/2.67 | 中央寄せ・上部集中・下部大量空白の典型的 AI 生成レイアウト; 「何を終わらせますか？」という中身のない万能プロンプト欄; 大きな未使用の空白領域 |
| `system.update-available` | COMPETITIVE | haiku:BELO opus:COMP sonnet:COMP | 3/2.33/3.67 | 日本語の機械翻訳ぽさが顕著（テキストが不自然、改行位置が奇妙）; 見出しの「！」と本文で同じ「入手できます」を反復する説明過多 |
| `voice.context-expanded` | COMPETITIVE | haiku:SUPR opus:BELO sonnet:BELO | 3.67/3.33/4.33 | 「要約 / 抽出 / 探す / 質問」というテンプレ 4 点セットの反復; 4項目とも同一の装飾アイコンを使い回している |
| `main.home` | COMPETITIVE | haiku:COMP opus:COMP sonnet:COMP | 4/3/4 | 「はじめに」の3行が『動詞＋すると＋結果』で完全に同型反復しており、機能説明を並べたテンプレ感がある; 中央上部に検索バー＋下に薄い提案リストという生成AIアプリの定型構成 |
| `components.pressed` | COMPETITIVE | haiku:COMP opus:BELO sonnet:COMP | 4/3.67/4 | 下部の「要約／決まったこと／やること」が用途の違いを示さない同形 pill 3連 |
| `system.update-unavailable` | BELOW_BAR | haiku:BELO× opus:BELO sonnet:BELO | 2/2/3.5 | 「更新を自動で確かめる設定を持たずに作られています」という内部事情の説明過多。利用者の行動に関係ない情報を丁寧に述べている; 同義語を言い換えずに繰り返す機械的な文章 |
| `system.resumed` | COMPETITIVE | haiku:COMP opus:BELO sonnet:BELO | 2.67/2.33/3.33 | 過度な白空間; 4つの同形タブが役割差なく等間隔に並ぶ; 中身のない広大な空白を埋める空状態デザインが用意されていない |
| `components.focus` | COMPETITIVE | haiku:COMP opus:BELO sonnet:BELO | 3/3/3 | 同形 pill 群にフォーカス表現を一律付与しており、状態を意味ではなくスタイルの一括適用で表している |
| `system.accessibility-permission` | COMPETITIVE | haiku:COMP opus:COMP sonnet:COMP | 3.67/3/3.67 | 「はじめに」3行の同型反復は 173D と同じ; 「はじめに」3行の説明的な文体は173Dと同様やや教科書的 |
| `session.project` | COMPETITIVE | haiku:COMP opus:COMP sonnet:COMP | 4/3/4 | カードが全て同じ角丸・同じ白・同じ影で、重要度の差がカード形状に出ていない |
| `meeting.preparing` | COMPETITIVE | haiku:COMP opus:BELO sonnet:COMP | 3.67/3/3.33 | 「Ask Astra」のスパークル装飾が AI 機能の記号として貼られているだけ |
| `main.library-meetings` | COMPETITIVE | haiku:COMP opus:COMP sonnet:BELO | 3.67/3/4.33 | 「できること」3 行が、機能説明を空状態に詰め込んだ定型の教育文リストになっている; 説明過多な箇条書き（できることリスト） |
| `main.new-recording-sheet` | COMPETITIVE | haiku:COMP opus:BELO sonnet:COMP | 3.33/3/3.67 | ラベル＋コントロールの定型フォームを 5 行並べただけで、頻度の差（マイクと保存先）が形に出ていない |
| `dock.result-failed` | COMPETITIVE | haiku:COMP opus:COMP× sonnet:BELO | 4/3/4 |  |
| `session.ready` | COMPETITIVE | haiku:COMP opus:COMP sonnet:BELO | 3.67/3/4 | カードが全て同一の角丸・影で、種類の違いが形に出ていない |
| `session.detail` | COMPETITIVE | haiku:COMP opus:BELO sonnet:COMP | 3.67/3/4 | 「要約 / 決まったこと / やること」という定型 3 段構成をそのまま見出し化 |
| `provenance.reopened` | COMPETITIVE | haiku:COMP opus:BELO sonnet:BELO | 3/3/4 | 「決まったこと / やること / メモ」の件数付き見出しをゼロ件でも機械的に並べる; 生成文の誤字（次の周）が未校正のまま表示されている |
| `system.calendar-permission` | COMPETITIVE | haiku:COMP opus:BELO sonnet:BELO | 3.33/2.67/3.67 | 空状態に 3 行の「はじめに」箇条書きを並べる定番の説明過多; 「まだ何もありません」的な空状態表現を複数箇所で重ねて使っている |
| `voice.context` | NOT_ENOUGH_EVIDENCE | haiku:NOT_ opus:NOT_ sonnet:NOT_ | 3/2/2.33 |  |
| `dock.result` | COMPETITIVE | haiku:COMP opus:BELO sonnet:COMP | 3.33/3/4 |  |
| `main.work-agents` | COMPETITIVE | haiku:COMP opus:BELO sonnet:COMP | 3.67/2.67/3.67 | 空状態＋「できること」3 行箇条書きという 398B と同一のテンプレ反復; 同一の空状態テンプレート（太字見出し＋グレー説明＋主CTA＋『できること』箇条書き）が別画面でもそのまま繰り返し使われている |
| `main.home-upcoming` | COMPETITIVE | haiku:COMP opus:BELO sonnet:COMP | 3.67/3/4 | サイドバー + メイン の二段構成は標準的なダッシュボードパターン; 全カードが同じ角丸・同じ影・同じ余白でテンプレ反復; 同一ラベルの録音ピルを機械的に繰り返している |
| `session.recording` | COMPETITIVE | haiku:COMP opus:COMP sonnet:COMP | 3.67/3.33/4.33 | ピンク色バナーは Google Meet の「ライブ」表示パターンをモダン化したもの; 同一角丸の白カード反復; 中央に浮く波形アイコン単体が装飾的な埋め草に見える |
| `dock.running` | COMPETITIVE | haiku:COMP opus:BELO sonnet:COMP | 3.67/3.67/4 | 暗いモーダル背景 + チェックリスト は modern だが generic pattern; Calendar / Gmail / Notion / Web と定番サービス名を並べただけのプラン表現 |
| `system.mic-denied` | BELOW_BAR | haiku:BELO× opus:BELO sonnet:BELO | 3.5/3/4 | 「まだありません」の反復（3 箇所）で空状態を埋める |
| `provenance.meeting-detail` | COMPETITIVE | haiku:SUPR opus:COMP sonnet:SUPR | 4.67/4/5 | 特になし強め。引用番号の設計は定型的でない |
| `components.hover` | COMPETITIVE | haiku:COMP× opus:COMP sonnet:COMP | 4/3.5/3.5 | 「まだありません」の反復 |
| `dock.confirmation` | COMPETITIVE | haiku:COMP opus:COMP sonnet:COMP | 4/3.33/4 |  |
| `meeting.ask` | COMPETITIVE | haiku:COMP opus:COMP sonnet:BELO | 3.33/2.67/3.67 | Purple/blue accent color on Ask Astra button is typical AI UI affordance; 定型質問 3 件が「決まったことは？／私のやることは？／反対意見や懸念は？」という会議 AI |
| `system.stt-unavailable` | COMPETITIVE | haiku:COMP opus:BELO sonnet:BELO | 3/2.67/3.33 | Structured auto-extraction of decisions/actions follows typical AI summarization UI patterns; 「まだありません」が 4 か所で反復され、空語のテン |
| `system.generic-failure` | COMPETITIVE | haiku:COMP opus:BELO sonnet:COMP | 4/3/4.33 | 「こんばんは」＋「何を終わらせますか？」という挨拶＋問いかけの定型ホーム |
| `provenance.source` | COMPETITIVE | haiku:COMP opus:BELO sonnet:BELO | 3.33/3.33/4.33 | Auto-structured meeting intelligence (decisions/actions/notes) is typical AI summarization UI; 右パネル下部の説明のつかない余白 |
| `system.after-sharing` | COMPETITIVE | haiku:SUPR opus:COMP sonnet:COMP | 4/3.33/4 | Ask Astra のスパークル記号が AI 機能の目印として使われている |
| `voice.quick-actions` | COMPETITIVE | haiku:COMP opus:COMP sonnet:COMP | 3.67/2.67/3.33 | アイコン＋短語のトリオを等間隔に置くだけの、汎用テンプレ的な帯構成; 汎用的なHUDピル、機能を示す差別化要素がなくテンプレート的 |
| `voice.idle` | COMPETITIVE | haiku:COMP opus:COMP sonnet:COMP | 4/2.67/4 | minimal-pill-template |
| `main.library-files` | COMPETITIVE | haiku:SUPR opus:BELO sonnet:COMP | 4.33/3/4.33 | 「できること」+ 矢印付き 3 行という説明過多の教育ブロック; 『できること』リストが同一矢印アイコンの反復で、やや説明過多なオンボーディング調 |
| `system.interrupted` | COMPETITIVE | haiku:COMP× opus:COMP sonnet:COMP | 4.5/3.5/4.5 | すべての行が同じ角丸カードの反復で、種類の違いが形に出ていない |
| `recording.workspace` | COMPETITIVE | haiku:COMP× opus:COMP sonnet:COMP | 4/3.5/4 |  |
| `system.speech-permission` | COMPETITIVE | haiku:COMP× opus:COMP sonnet:COMP | 4/3.5/4 | 同一メッセージの 3 箇所反復による説明過多 |
| `meeting.workspace` | COMPETITIVE | haiku:COMP opus:BELO sonnet:BELO | 3.67/3/4 | excessive whitespace suggesting template incompleteness; 「決まったこと/やること/質問/懸念」の 4 分類が全部同じ行フォーマットで反復し、テンプレ感が出ている |
| `dock.confirmation-edit` | COMPETITIVE | haiku:COMP opus:BELO sonnet:BELO | 3.33/2.67/3.67 | generic modal dialog pattern |
| `meeting.paused` | COMPETITIVE | haiku:SUPR opus:COMP× sonnet:COMP | 4/3.5/4 |  |
| `components.neutral` | COMPETITIVE | haiku:BELO opus:BELO sonnet:COMP | 3/2.33/3.33 | extensive whitespace suggesting unfilled template state; 「まだありません」を各ラベルに機械的に反復 |
| `dock.context-detail` | COMPETITIVE | haiku:COMP opus:BELO sonnet:COMP | 3.67/4/4 | 3 枚同サイズ・同角丸のカードを機械的に横並びにしたテンプレ構図 |
| `session.processing` | COMPETITIVE | haiku:COMP opus:BELO sonnet:COMP | 3.33/3/4 | generic sidebar navigation pattern; 挨拶＋「何を終わらせますか？」の大型入力欄という定番 AI ホーム構図 |
| `main.apps-plugins` | COMPETITIVE | haiku:COMP opus:BELO sonnet:COMP | 3.33/2.67/4 | 同じ角丸・同じ影のカードを 2 列で機械的に反復; 全カードが同一テンプレート（アイコン+名前+バージョン+権限pill）の反復で個性がない |
| `main.work-tasks` | COMPETITIVE | haiku:SUPR opus:COMP sonnet:COMP | 4.33/3.67/4.67 | 「Astra に頼んだ仕事。」→「まだ仕事はありません」→「Astra に頼んだ仕事はここにまとまります。」と同じことを 3 回言う説明過多; 『できること』という箇条書きヒントが他画面の説明文とも似た調子で繰り返し登場し、テンプレ的な説明 |
| `main.apps-connectors` | COMPETITIVE | haiku:COMP opus:BELO sonnet:BELO | 2.67/2.33/3.67 | inconsistent status indicators across similar items; 3 枚だけのカードを横 3 列に伸ばして幅いっぱいを埋める、内容量に合わないグリッド; コンテンツ量に対しキャンバスが広すぎ、意図的な |
| `settings.permissions` | COMPETITIVE | haiku:COMP opus:BELO sonnet:COMP | 3.33/2.67/4.33 | radio button styled as tab interface; 各権限に必ず一文の説明を付ける説明過多。マイクと音声認識で同じことを二度言っている; 各許可項目の説明文が『〜には〜の許可が要ります』という同一構文の反復でやや機械 |
| `recording.agent-timeline` | COMPETITIVE | haiku:SUPR opus:COMP sonnet:COMP | 4.33/4/4.67 | 「決まったこと」「やること」という定型セクションを空でも常設し「まだありません」を 2 回並べている; 『AI が見ている資料 3件』という補足フッターがやや説明過多気味 |
| `system.confirm-cancel` | COMPETITIVE | haiku:BELO× opus:COMP sonnet:COMP | 4/3.5/4.5 |  |
| `meeting.controller` | COMPETITIVE | haiku:COMP× opus:COMP sonnet:COMP | 4/3/4 | Sparkle icon on "Ask Astra" is a fairly stock AI-feature affordance |
| `voice.preparing` | NOT_ENOUGH_EVIDENCE | haiku:NOT_× opus:BELO× sonnet:BELO× | -/-/- |  |
| `recording.transcript` | COMPETITIVE | haiku:SUPR opus:BELO sonnet:BELO | 4/3.67/4.33 | 「まだありません」を空状態の常套句として置いたまま、隣に材料が揃っている矛盾; "AIが見ている資料" footer phrasing is a common AI-transparency pattern, used here witho |
| `meeting.captions` | COMPETITIVE | haiku:COMP opus:COMP sonnet:COMP | 3.33/3/4 | 情報 4 行に対してパネル高さが過剰で、余白が意味を持っていない |
| `recording.meeting-canvas` | COMPETITIVE | haiku:SUPR opus:COMP sonnet:COMP | 4/4/4.33 | 同一メタデータ（話者・時刻）を行頭と行下で 2 度繰り返す説明過多; Categorization taxonomy (決まったこと/やること/質問/懸念) is specific rather than generic AI buzzwo |
| `provenance.library-after-end` | COMPETITIVE | haiku:COMP opus:BELO× sonnet:BELO | 3/2.5/4 | Numbered footnote-style [1][2][3] citations linking prose back to transcript lines feels like a generic AI-report conven |
| `meeting.notes` | COMPETITIVE | haiku:COMP opus:COMP sonnet:COMP | 3.67/3/4 | 「決まったこと／懸念／やること／質問」がそれぞれ綺麗に1件ずつ、というフレームワーク充填的な整い方; Auto-bucketing transcript lines into 決まったこと/懸念/やること/質問 is now a very  |
| `system.mic-recovered` | COMPETITIVE | haiku:COMP opus:COMP sonnet:NOT_ | 4/3/3.67 |  |
