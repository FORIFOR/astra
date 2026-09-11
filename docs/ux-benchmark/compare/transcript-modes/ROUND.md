# 原文・翻訳の2モード（2026-09-11）

reference : Astra [DESIGN.md §0・§6](../../../../shared/design/DESIGN.md) の「chrome is quiet」と面を増やさない規則、2026-09-11のユーザーによる「大きな字幕は必要ないかもしれません」という依頼。
hypothesis: Dockと作業画面に共通の表示切替を3項目から2項目へ整理する。原文でもライブ文字起こしを読めるため、別サイズの表示を独立モードにしない。
measured  : 現実装は原文・翻訳・大きな字幕の3項目。ボタン高さ32pt、横padding10pt、群padding3pt。作業画面の右列はtokensの320pt。
candidates: A=3項目を維持、B=原文・翻訳の2項目。ユーザーの依頼に沿ってBを採用対象とし、字体・間隔・窓寸法は変更しない。
gate      : Dock/作業画面で原文・翻訳が到達可能、ライブ原文と翻訳の内容が維持されることを合成fixtureで確認。light/darkのgoldenとgeometryを更新し、Swift・用語・ガイド整合性・占有を検証する。外部STT/LLMへの課金リクエストは発生させない。
