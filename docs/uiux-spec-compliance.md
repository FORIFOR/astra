# UI/UX Detailed Spec v0.1 — 準拠状況（2026-08-28）

正: `Astra_UI_UX_Detailed_Spec_v0.1.docx`。ネイティブ（macOS/Windows）を最終製品とし、
Tauri/React 版 `apps/desktop` は参照実装。mock と real を分け、逸脱は捏造せず明記する。

## 準拠（✅）

- **参照実装 `apps/desktop`**: 4タブ Home/Work/Library/Apps（`goToTab('work')`）、`dock/TaskDock.tsx`・
  `dock/ContextLens.tsx`・`work/WorkCard.tsx`・`pages/Work.tsx`（§2/§4/§5/§6/§9 の骨格）。
- **§2.1 / AC-12 トップナビ**: ネイティブも **Home / Work / Library / Apps** に修正済（内部 enum は .agents 保持可）。
- **§17 Visual Design System 単一正**: color(Light/Dark 9token, accent **#5B4CF0**)/type(6role)/space/radius を
  `shared/design/tokens.json` に集約し、Swift(`Palette`/`TypeScale`/`Space`)・C# へ生成（直書き廃止）。
- **§20 shortcuts**: ⌥Space / Ctrl+Alt+Space。**§4.4/AC-05 durable task**: 中断復帰実装。

## 逸脱（要対応 / external でなく実装方針の相違）

| Spec                      | 期待                                                                                                     | 現状（ネイティブ）                                                                              | 区分   |
| ------------------------- | -------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | ------ |
| §4.1 Task Dock            | Ready **560×56**・下部中央 Intent Bar（Intent field+Mic+Attach+Context chips）                           | `taskDock:{250×42}`＋上部 Voice HUD 310×31(notch)                                               | 再設計 |
| §12 Meeting (AC-08)       | **Notes first**・Transcript default closed・録音は 360–420×48–56 minimal indicator・大波形を主役にしない | 920×590 録音中心 Workspace＋大 Recording Hero(録音中+波形が主役)                                | 再設計 |
| §7.1 shell / §3 / §5 / §6 | sidebar208/64・top56・inspector320・Context Lens・Work Surface semantic progress                         | ネイティブは Main タブ中身が薄い(Windows NavigateTo はスタブ)・Context Lens/Work Surface 未移植 | 実装   |

## 是正済み commit

- ナビ Work 化: `6aaa62f`
- §17 token 単一正 + accent #5B4CF0: `d2cfa9f`
- §4.1 Task Dock geometry token + IntentBarView(§4.3): 本コミット

## 残（判断待ち）

(B) ネイティブ Task Dock を 560×56 下部中央 Intent Bar へ、(C) Meeting を Notes-first へ、
(D) ネイティブ Home/Work/Library/Apps のページ中身と Context Lens/Work Surface 移植。いずれも実質再設計。
