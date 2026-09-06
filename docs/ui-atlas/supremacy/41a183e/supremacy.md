# Blind supremacy review — RC 41a183e（8 軸・自己採点・人手 0）

SUPREME 0 / COMPETITIVE 52 / BELOW_BAR 3 / NEE 7 → VISUAL_SUPREMACY(blind)=FAIL

BELOW_BAR は「有効 judge 全員が BELOW_BAR」。1 人の趣味では落とさない。A/B 競合比較は competitor 画像が要る（AUTOMATION_MISSING）。

| id | verdict | judges | avg(craft/dist/hier) | ai_look |
|---|---|---|---|---|
| `main.home-upcoming` | COMPETITIVE | haiku:COMP opus:COMP sonnet:COMP | 3.67/3/4 | セクション見出し・カード・角丸が全部同一の均質リズムで、重み付けが弱い |
| `system.mic-recovered` | NOT_ENOUGH_EVIDENCE | haiku:COMP opus:COMP× sonnet:NOT_× | 5/3/4 |  |
| `system.stt-unavailable` | COMPETITIVE | haiku:COMP opus:BELO sonnet:BELO | 3/2.67/3 | 空状態が「まだありません」「まだ発話がありません」「まだありません」と3か所で同じ語を反復; 中央〜左寄せの広い空白領域に対して情報密度が低く、空状態っぽい表示が長時間録音中でも解消されない |
| `main.work-tasks` | COMPETITIVE | haiku:BELO opus:BELO sonnet:COMP | 3/2/3.67 | Verbose instructional empty state; 説明過多 — 同じ意味の一文が見出し下と空状態で二重に書かれる; 典型的な空状態パターン(大見出し+説明+紫の単一CTA+箇条書きヒント)で個性が薄い |
| `main.apps-connectors` | COMPETITIVE | haiku:COMP opus:BELO sonnet:COMP | 3.33/2.33/3.67 | 同一文言をカード間でコピーした説明の反復 |
| `session.detail` | COMPETITIVE | haiku:SUPR opus:COMP sonnet:SUPR | 4/3.67/4.67 | 要約項目が発言のコピペそのままで、抽象化された形跡が無い |
| `main.home-recording-now` | COMPETITIVE | haiku:COMP opus:COMP sonnet:COMP | 3.67/3/4 | 全カードが同じ角丸・同じ影・同じ余白でテンプレ反復 |
| `recording.agent-timeline` | COMPETITIVE | haiku:COMP opus:BELO sonnet:BELO | 3.33/2.67/3.67 | Summary section template feels slightly generic with checkbox/radio patterns; 『会話を用意する／文字起こしを読む／答えをまとめる』という中身の無い工程リストで進行 |
| `dock.result` | COMPETITIVE | haiku:SUPR opus:BELO sonnet:COMP | 3.67/3/4.33 | 『2 件のソースから作成しました』という根拠の体裁だけ整えた定型文; 緑チェック+ダークカード+2つのpillボタンという構成は、AI完了通知として非常によく見るテンプレート |
| `dock.result-failed` | COMPETITIVE | haiku:BELO× opus:COMP sonnet:BELO | 3.5/3/4 | 11CBと同一のトーストパターンを警告色に差し替えただけ |
| `voice.listening` | NOT_ENOUGH_EVIDENCE | haiku:SUPR× opus:COMP× sonnet:COMP× | -/-/- |  |
| `meeting.preparing` | COMPETITIVE | haiku:COMP opus:BELO sonnet:BELO | 3.33/2.67/3.67 | ラベル付きアイコンを等間隔に並べたツールバーのテンプレ配置; 117Aのフローティングバーとほぼ同一パターンの使い回しに見える |
| `voice.idle` | NOT_ENOUGH_EVIDENCE | haiku:NOT_ opus:NOT_ sonnet:NOT_ | 3.33/2.33/2.67 | Generic minimal header pattern; 中央の意味のない余白 |
| `meeting.workspace` | COMPETITIVE | haiku:COMP opus:BELO sonnet:COMP | 3.67/3.33/4 | Sidebar category pattern common in meeting tools; 「決まったこと/やること/質問/懸念」という 4 分類テンプレの均等反復（各カテゴリちょうど 1 件ずつという出来過ぎた配分） |
| `voice.quick-actions` | NOT_ENOUGH_EVIDENCE | haiku:NOT_ opus:NOT_ sonnet:NOT_ | 2.67/1.67/2.67 | Generic icon + label button pattern; アイコン+短語を等間隔で 3 つ並べただけのテンプレ構成; 等間隔3分割の記号的レイアウト |
| `system.interrupted` | COMPETITIVE | haiku:COMP opus:BELO sonnet:COMP | 4/2.67/4 | Sidebar navigation is standard macOS pattern; 「こんばんは」＋「何を終わらせますか？」という汎用 AI ホームの定型 |
| `components.hover` | COMPETITIVE | haiku:COMP opus:BELO sonnet:COMP | 3/2.67/3.33 | Same sidebar pattern as 2B04; 空状態を小さな一言（まだありません）で済ませ、残りを何も置かずに空けるパターン; 左側の大きな空白領域を埋めるコピーがなく、テンプレの空状態感がある |
| `provenance.library-after-end` | COMPETITIVE | haiku:COMP opus:BELO sonnet:COMP | 3.67/2.67/4 | Accordion section pattern (count + label + collapsible content) is standard UI template; 「決まったこと / やること / メモ」の定型 3 分類を、件 |
| `main.apps-plugins` | COMPETITIVE | haiku:COMP opus:BELO sonnet:BELO | 3.33/2.33/3.67 | uniform circular badge styling; 全カード同一角丸・同一影・同一構造のテンプレ反復; 全カード同一チェックマークで権限の重さに関わらず差がない |
| `voice.preparing` | NOT_ENOUGH_EVIDENCE | haiku:COMP× opus:COMP× sonnet:NOT_× | -/-/- |  |
| `recording.meeting-canvas` | COMPETITIVE | haiku:SUPR opus:COMP sonnet:COMP | 3.67/4/4.67 | 下部の 要約 / 決まったこと / やること チップが左の見出しと同語反復 |
| `recording.rag` | COMPETITIVE | haiku:COMP opus:BELO sonnet:COMP | 3.67/3.33/3.67 | tab-based resource organization; 『この会議の発言 · 語が 2 件一致 · 新しい · このプロジェクト』という中身の薄いメタ語の反復 |
| `system.speech-permission` | COMPETITIVE | haiku:BELO× opus:COMP sonnet:COMP | 4/3.5/4 |  |
| `meeting.controller` | COMPETITIVE | haiku:COMP opus:COMP sonnet:BELO | 3.67/3/3.33 | Ask + 製品名 という定型のアシスタント呼称; よくあるダークpill型オーバーレイの汎用形状 |
| `main.home` | COMPETITIVE | haiku:COMP opus:COMP sonnet:SUPR | 4.33/3.33/4.33 | 「はじめに」3 行が全て矢印アイコン + 同じ長さの機能説明で、テンプレ的な三点セット |
| `main.library-meetings` | COMPETITIVE | haiku:COMP opus:BELO sonnet:COMP | 4/2.33/4 | 紫のフル角丸ボタン + 薄紫 pill という既定 AI 配色; 空状態のTipsブロックがHome画面と同一パターンの反復（矢印箇条書き×3、見出し「〜こと」） |
| `dock.confirmation` | COMPETITIVE | haiku:BELO opus:COMP sonnet:SUPR | 4/3.67/4.33 | multiple redundant action buttons create visual clutter |
| `session.processing` | COMPETITIVE | haiku:COMP opus:COMP sonnet:SUPR | 4.33/3.33/4.33 | 予定カード・会議カードが全て同じ角丸・同じ白カードで、重要度差がカード表現に反映されていない |
| `system.mic-denied` | BELOW_BAR | haiku:BELO opus:BELO sonnet:BELO | 3/3/3.33 | tan/beige banner is dated color choice; 空状態の文言が「設定を開く」の指示をそのまま繰り返しており、警告バーと二重に同じことを言っている |
| `system.calendar-permission` | COMPETITIVE | haiku:COMP opus:BELO sonnet:SUPR | 4.33/3/4 | 「はじめに」3 行が 610C と完全に同一の反復テンプレ |
| `settings.permissions` | COMPETITIVE | haiku:BELO opus:BELO sonnet:COMP | 2.33/2.33/4 | Text overflow/truncation is unfinished; 「許可が要ります」という同一構文の説明文を 4 行連続で反復（テンプレ反復・説明過多）; 下部の説明を置いただけの余白が目的なく広い |
| `system.after-sharing` | COMPETITIVE | haiku:COMP opus:COMP× sonnet:COMP | 4/3/4 |  |
| `provenance.meeting-detail` | COMPETITIVE | haiku:COMP opus:COMP sonnet:COMP | 4/3.33/4.67 |  |
| `components.neutral` | BELOW_BAR | haiku:BELO opus:BELO sonnet:BELO | 3/2.67/3.33 | Text duplication suggests rendering or content generation defect; 左カードのタイトルが「会議」という空語; 空状態(まだありません)の下に何もない余白が広く残る、テンプレ的な |
| `meeting.paused` | COMPETITIVE | haiku:COMP opus:BELO× sonnet:COMP | 4/3/4 |  |
| `session.project` | COMPETITIVE | haiku:COMP opus:BELO sonnet:COMP | 4/3.33/4.33 | 時刻に依存する挨拶を大見出しに置く定番構成; 検索バーの汎用的なプレースホルダー文言 |
| `provenance.reopened` | COMPETITIVE | haiku:COMP opus:COMP× sonnet:BELO | 4/3/4 |  |
| `dock.running` | COMPETITIVE | haiku:COMP opus:BELO× sonnet:COMP | 4/3.5/4.5 | Uniform list pattern with identical checkmark styling for each item feels templated |
| `system.generic-failure` | COMPETITIVE | haiku:SUPR opus:BELO sonnet:COMP | 4/3.33/4.33 | 挨拶＋『何を終わらせますか？』の大型入力欄という AI ホームのテンプレ構成 |
| `main.work-agents` | COMPETITIVE | haiku:COMP opus:BELO sonnet:COMP | 3.67/2/3.67 | Instruction list has uniform, templated appearance; 空状態に「できること」3 箇条を並べる説明過多のテンプレ; 空状態下の「できること」箇条書き+矢印アイコンの説明パターンはAI生成アプリ |
| `main.library-files` | COMPETITIVE | haiku:COMP opus:BELO sonnet:COMP | 3.67/2/3.67 | Instruction list pattern matches 8BDE—templated feel; 空状態＋「できること」3 箇条という 8BDE と同一のテンプレ反復; 8BDEと同一構造（見出し+説明文+CTA+「できること」箇 |
| `system.confirm-cancel` | COMPETITIVE | haiku:COMP× opus:BELO sonnet:SUPR | 4.5/3.5/4.5 |  |
| `system.update-unavailable` | COMPETITIVE | haiku:COMP opus:BELO sonnet:COMP | 3/1.67/3.67 | アプリアイコンが実物ではなくプレースホルダ格子のまま置かれている; 汎用的なグリッドアイコンのプレースホルダー感 |
| `system.accessibility-permission` | COMPETITIVE | haiku:COMP opus:COMP sonnet:COMP | 3.33/3/4 | Abundant whitespace and centered empty state — while intentional for calm aesthetic, follows generalized spacious design |
| `dock.context-detail` | COMPETITIVE | haiku:COMP opus:COMP sonnet:COMP | 4/3.67/4 | 3枚のカードが完全に同一の角丸・同一グリッドで、種別による差が視覚化されていない |
| `provenance.source` | COMPETITIVE | haiku:COMP opus:COMP sonnet:BELO | 4/3.67/4.33 | タブが4つとも同形の角丸ピルで、選択状態の色以外に差が無い |
| `dock.confirmation-edit` | COMPETITIVE | haiku:COMP opus:BELO sonnet:BELO | 3.33/2/4 | 確認ダイアログの体裁だけ整えて、ボタン文言が画面の問いと接続していない |
| `voice.context` | COMPETITIVE | haiku:NOT_× opus:COMP sonnet:COMP | 3.5/2/3 | 汎用の折り畳みヘッダそのもので、製品固有の判断が何も入っていない |
| `system.resumed` | COMPETITIVE | haiku:COMP opus:BELO sonnet:BELO | 3.33/2.33/3.33 | 「決まったこと 0」「やること 0」を機械的に並べただけで、0 のときの扱いが設計されていない; 中央/上部に情報を寄せて残りを空白のまま放置する典型的な空状態処理 |
| `meeting.notes` | COMPETITIVE | haiku:COMP opus:COMP sonnet:COMP | 3.67/3.67/4 |  |
| `main.new-recording-sheet` | COMPETITIVE | haiku:COMP opus:BELO sonnet:COMP | 3.33/3/3.67 | ラベル＋セレクトを 5 行ただ縦に積んだだけの設定シートで、既定値の重み付けが無い |
| `session.recording` | COMPETITIVE | haiku:SUPR opus:COMP sonnet:COMP | 4/3.33/4.67 | 下 1/3 の空白を埋める設計が無く、コンテンツが尽きたまま放置されている |
| `voice.thinking` | NOT_ENOUGH_EVIDENCE | haiku:NOT_ opus:NOT_ sonnet:NOT_ | 3.33/2/2.67 | きらめきアイコン＋「考えています...」という、AI 製品の最も手垢のついた組み合わせ |
| `voice.context-expanded` | COMPETITIVE | haiku:COMP opus:BELO sonnet:COMP | 3.33/2.33/4 | Generic AI-prompt suggestions without tailored language or context; standard icon+text pill pattern common in AI assista |
| `recording.workspace` | COMPETITIVE | haiku:COMP opus:COMP sonnet:COMP | 4/2.67/4 | 左パネル・右パネル・下部入力すべてが同一半径の角丸カードで、要素の役割差が形に出ていない; AIノートテイカーの定番構成（左サマリー＋右トランスクリプト＋下部AI言及）で既視感が強い |
| `components.pressed` | COMPETITIVE | haiku:COMP opus:BELO sonnet:COMP | 3.33/2.33/3.67 | pill-style background container for AI indicator feels like templated component styling; 状態表現を『枠を足す』だけで済ませており、選択・ホバー・フォー |
| `components.focus` | BELOW_BAR | haiku:BELO opus:BELO sonnet:BELO | 2/1.67/2.67 | uniform blue border focus states across all elements — generic a11y treatment; フォーカス表現を全要素に機械的に一括適用したように見え、要素ごとの重み付けが無い; |
| `session.ready` | COMPETITIVE | haiku:SUPR opus:BELO sonnet:COMP | 4/3.33/4.33 | 予定カード・会議カード・録音カードが全て同じ角丸・同じ白カードで、種類の違いが形に出ていない; 「挨拶＋大きな検索/コマンド入力欄」という構成は近年のAIプロダクトのヒーローパターンの定番 |
| `meeting.captions` | COMPETITIVE | haiku:COMP opus:COMP sonnet:COMP | 4/3.33/4 | タブ群を上下 2 段で同じ意匠のまま反復しており、階層の作り分けが弱い |
| `recording.transcript` | NOT_ENOUGH_EVIDENCE | haiku:COMP× opus:BELO× sonnet:BELO | 3/2/3 | 要約パネルが会話内容に追従していない点は、生成AIの後追い集計処理が間に合っていない印象を与える |
| `system.update-available` | COMPETITIVE | haiku:BELO× opus:BELO sonnet:COMP | 3/2/3.5 | リリースノートが「変わること/直したこと」の教科書的2ブロック＋箇条書きで、テンプレの型がそのまま出ている; 箇条書き全項目が同じ文の長さ・同じ丁寧さで書かれており、優先順位付けされた「見出し級」の訴求がない（生成された網羅列挙に見える） |
| `meeting.ask` | COMPETITIVE | haiku:COMP opus:COMP sonnet:COMP | 3.33/3.33/4 | 「よく聞くこと」＋矢印付き3件のサジェストが、AI チャット初期画面のテンプレそのまま; ✨アイコン＋「この会議について聞く」という定型的なAIアシスタント訴求 |
