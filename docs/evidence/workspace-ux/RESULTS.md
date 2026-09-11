# Workspace UX audit and implementation · 2026-09-11

User request: inspect the actual Astra app and improve UI/UX before expanding capabilities.

## Implemented

- Home has a multiline request editor, a visible Send button and a shared ⌘Return shortcut. Return inserts a newline. Unsent drafts survive navigation, and requests that fail preflight do not erase them. Only one VoiceHUD request can be in flight, independently of Dock presentation.
- Native macOS Edit menu restores Select All, Copy, Paste, Undo and Redo. Previously clipboard paste timed out because the app never installed these responder-chain keyboard commands.
- Home replies are selectable and copyable. Recent work is shown before secondary context, with a link to the full history. Empty pressure bars no longer consume a section.
- Task rows open a detail view with saved step details and failure reasons. Search includes step details and combines with the state filter. Opening a history row never repeats an external action. The previous Home retry incorrectly routed arbitrary work through meeting AI and has been removed.
- Step details now survive SQLite persistence. JSON storage reads the existing legacy delimiter format, preserving previous tasks. Notifications refresh visible history after saves.
- Apps starts on Connections. Google Workspace and Microsoft 365 group the actual supported read connections; unsupported manifest entries are no longer presented as connectable services. Developer configuration is collapsed. Existing OAuth scopes and consent flows are unchanged.
- Sidebar Settings replaces the hardcoded `ui-check` identity. A labeled toolbar recording action stays accessible when the Home content scrolls. Subnavigation uses real keyboard-operable buttons, and controls have meaningful accessibility labels.
- Library no longer claims audio always stays on-device when the user has enabled Google live STT.

## Verification

| Check | Result |
| --- | --- |
| Swift unit suite | 98 passed, 0 failed, including five new workspace behavior/persistence tests |
| Native workspace captures | 20 captures across five states, light/dark, 940pt and 1162pt widths |
| Measured native window sizes | 940×672pt and 1162×768pt; smaller fixture requested 620pt height, native minimum applied |
| Standard screenshots | 16 per appearance; 32 total |
| Existing golden comparisons | 10 per appearance match; no existing golden image changes required |
| AX geometry | Six states measured again |
| Screen occupation | All seven measured surfaces within existing token limits |
| Native CUA interaction | Paste, select all, newline, undo, redo, ⌘Return, draft retention, answer copy/paste, task detail/copy, filtering and detail-text search passed |
| Guide, terminology, tokens, type scale, UI taste | Checked against current implementation |
| Existing journeys | JA/JB/JC and recording crash → restore passed |

Fixtures run with an explicit temporary `ASTRA_DATA_ROOT` and `MainWindowView(loadBackend: false)`. No model or speech API request is made by these new fixtures. Existing user recordings/history and account tokens were preserved.

The first clipboard test failed on the old implementation; the same native clipboard operation passed after ApplicationMenu was added. The unauthenticated Send test visibly retained both lines of the draft and showed a connection explanation. Copy was validated by pasting the copied text back into the editor.

## Full release gate remains separate

`verify-all.sh` was run. The first core network test failed because this run explicitly used an unavailable gateway URL to isolate UI fixtures; rerunning core against the actual local gateway passed all 38 tests. Tauri Rust passed 67 tests (3 ignored). The macOS recording suite then stopped at its existing live `aiaction` gate; consequently the aggregate is **not green**, and this round does not establish `release=go` or justify a commit/push under AGENTS.md.

The visible Connections UI correctly reports missing client configuration in an environment without configured client IDs. This work does not claim successful live OAuth reconnection, a live VoiceOver/FKA certification, or that the broader video/artifact execution platform is finished.

Screenshots and per-image hashes: [workspace-ux](../../golden-screenshots/workspace-ux/). Design reasoning: [ROUND.md](../../ux-benchmark/compare/workspace-ux/ROUND.md).
