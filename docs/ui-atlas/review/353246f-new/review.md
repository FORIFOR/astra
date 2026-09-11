# Blind pixel review — RC 353246f（judge: haiku, opus, sonnet、人手 0）

KEEP 7 / FIX_CANDIDATE 1 / NOT_ENOUGH_EVIDENCE 1 → VISUAL_IDEAL_GATE=FAIL

FIX_CANDIDATE は「有効な judge 全員が FIX」。deterministic evidence（寸法・AX・state truth）と突き合わせて初めて FIX にする。

| id | verdict | judges（model:verdict、無効は ×） | concerns |
|---|---|---|---|
| `guided-setup.repositioned` | KEEP | haiku:KEEP opus:KEEP sonnet:FIX | trust-provenance: アプリ名の欄にバージョン番号らしき「2.1.260」がそのまま表示されており、どのアプリを指すか利用者が判別できない |
| `guided-setup.target-highlighted` | KEEP | haiku:KEEP× opus:FIX sonnet:NOT_ENOUGH_EVIDENCE | alignment: 案内バーが下部ツールバーに重なり、「+」の隣にあるはずの「−」ボタンを覆い隠している（同じ画面の別カットでは「+」「−」が並んでいる）; error-recovery clarity: 案内を閉じる/やめるための操作が画面上に見当たらず、指示に従う以外の出口が読み取れない |
| `guided-setup.target-missing` | KEEP | haiku:KEEP opus:FIX× sonnet:FIX | primary-action-clarity: 設定を開く導線ボタンがなく、テキスト指示のみで具体的な操作アクションが提供されていない |
| `guided-setup.target-found` | KEEP | haiku:KEEP opus:FIX sonnet:FIX | alignment: 案内バーがウインドウ下部のツールバーに重なり、「+」の隣の「−」ボタンを覆っている; state legibility: 追加せよと言われている「Astra」が一覧に無い一方、よく似た「AstraDbg」が既にオンで、どれが対象なのか画面から区別できない; consistency: 「AstraDbg」と「Astra」という紛らわしい2つの項目が並び、どちらが案内対象か混乱を招く |
| `guided-setup.intro` | FIX_CANDIDATE | haiku:FIX opus:FIX× sonnet:FIX | state legibility: ユーザーが取るべき具体的なアクションが不明確。「1つ設定してください」だけでは、何を選択・変更すべきか判断できない。; primary-action clarity: エラー/要件メッセージが曖昧。次のステップが明記されていない。; error-recovery-clarity: 「1つ設定してください」が対象を明示しておらず、利用者がどの設定を直せばよいか分からない |
| `screenshot.attached-cloud` | KEEP | haiku:KEEP× opus:KEEP sonnet:KEEP |  |
| `guided-setup.granted` | NOT_ENOUGH_EVIDENCE | haiku:KEEP× opus:FIX× sonnet:FIX× |  |
| `screenshot.detected` | KEEP | haiku:KEEP× opus:KEEP sonnet:KEEP |  |
| `guided-setup.denied` | KEEP | haiku:KEEP opus:FIX sonnet:FIX | error-recovery clarity: 回復手順を文章で指示しているのに、その操作へ進む手段が画面内に用意されていない。ユーザーは文章を覚えて自力で辿る必要がある; primary-action clarity: 押せる対象が実質 × のみで、主要な行動が視覚的に示されていない; error-recovery clarity: 原因と対処法は文章で示されるが、システム設定を直接開くアクション（ボタン/リンク）が用意されておらず手動操作を強いる; contrast: エラー状態のアイコン背景が成功状態と同じ中立グレーで、状態の重大度がアイコン色のみに依存し視認性が弱い |
