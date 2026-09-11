# Blind pixel review — RC b10b7ca（judge: haiku, opus, sonnet、人手 0）

KEEP 7 / FIX_CANDIDATE 2 / NOT_ENOUGH_EVIDENCE 1 → VISUAL_IDEAL_GATE=FAIL

FIX_CANDIDATE は「有効な judge 全員が FIX」。deterministic evidence（寸法・AX・state truth）と突き合わせて初めて FIX にする。

| id | verdict | judges（model:verdict、無効は ×） | concerns |
|---|---|---|---|
| `guided-setup.denied` | KEEP | haiku:KEEP opus:FIX sonnet:FIX | error-recovery clarity: 「開けませんでした」という失敗に対して、唯一の行動が同じ「システム設定を開く」であり、原因も代替手順も示されていないため、押しても同じ結果になる可能性が読み取れない; primary-action clarity: 再試行なのか別経路なのかがボタン文言から区別できない; screen occupation: 赤い警告アイコンがピルの右端で切れて表示されている |
| `guided-setup.target-highlighted` | KEEP | haiku:KEEP opus:FIX sonnet:FIX | trust-provenance: システム設定の一覧の上に重ねられた吹き出しに、発信元を示すアイコン・名前・尻尾がなく、システム自身の表示なのかアプリの表示なのか判別できない; state legibility: 「再起動すると使えます」とあるが、何を再起動するのか（アプリか Mac か）が文言から特定できない; screen occupation: 通知バッジが画像の角で切れて全体が見えない |
| `screenshot.detected` | KEEP | haiku:KEEP× opus:KEEP sonnet:KEEP |  |
| `guided-setup.target-missing` | KEEP | haiku:KEEP opus:KEEP sonnet:FIX | alignment: 右端の円形アイコンが画像枠で途切れている |
| `guided-setup.intro` | FIX_CANDIDATE | haiku:KEEP× opus:FIX sonnet:FIX | primary-action clarity: 本文がシステム設定を開くことを求めているのに、実行できるボタンが無く、押せるのは閉じる × だけ; consistency: 同じ「システム設定でオンにする」依頼を出す別の pill にはボタンがあるのに、こちらは文面だけで操作導線が欠けている; primary-action clarity: 設定をオンにするよう指示しているのに、直接遷移できるボタンがない |
| `guided-setup.target-found` | KEEP | haiku:KEEP opus:FIX sonnet:KEEP | state legibility: 「オンです」と書かれた行のトグルだけが白く、同じ一覧でオンの他のトグルの青と異なる見え方をしており、オンなのかオフなのかが絵から読み取れない; trust-provenance: システム設定のウインドウ内に、発信元の名前もアイコンも無い吹き出しが重ねられており、OS の表示と区別できない |
| `guided-setup.granted` | NOT_ENOUGH_EVIDENCE | haiku:KEEP× opus:FIX× sonnet:KEEP× |  |
| `guided-setup.target-add` | FIX_CANDIDATE | haiku:FIX opus:FIX sonnet:FIX | state legibility: VoiceOS toggle is OFF while all visible neighbors are ON, but no hint text or status indicator explains why this app alone is disabled; consistency: Left sidebar and right content panel have noticeably different background colors (dark vs. light gray), creating visual separation th |
| `screenshot.attached-cloud` | KEEP | haiku:KEEP× opus:KEEP sonnet:KEEP |  |
| `guided-setup.repositioned` | KEEP | haiku:KEEP opus:FIX sonnet:FIX | state-legibility: 文言は「オンです」と言うのに、強調されたスイッチは他行の塗りつぶされた青いスイッチと見た目が異なり、白く抜けてオフのように読める。状態表示と説明文が矛盾して見える; error-recovery-clarity: 「再起動すると使えます」とだけ言い、何を再起動するのか（対象アプリか Mac か）も、再起動を始める手段も画面上に無い。次の一歩が利用者任せになる; trust-provenance: アプリ一覧の先頭項目が「2.1.260」というバージョン番号のような文字列のままで、どのアプリかを利用者が識別できない |
