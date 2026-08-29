# 外部参照画像

## `voiceos-task-dock.png`（未着）

Task Dock の外形を **VoiceOS の実機スクリーンショット**と直接比べるための参照。
ここに置かれると `pnpm verify:all` が自動で外形マスク比較を走らせる（無ければ SKIP）。

置き方:

1. VoiceOS の Task Dock だけを切り出した PNG を `voiceos-task-dock.png` として置く
2. `apps/astra-macos/.build/debug/AstraMac --selftest dockdiff docs/reference/voiceos-task-dock.png /tmp/astra-dock`

比較するのは色や文言ではなく **2 値の外形マスク**（面か背景か）。ブランド文言が違っても
形・肩の張り出し・下部の絞り・比率だけを見る。目標は一致 99% 以上。

現状: 参照画像が未着のため **external verification pending**。
Astra 側の寸法は `shared/design/tokens.json` の `voiceHud` に置いてあり、
参照が届いたらそこの数値だけを動かして詰める（View に数値を散らさない）。
