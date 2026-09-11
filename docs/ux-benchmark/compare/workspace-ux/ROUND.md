# Workspace UX · 2026-09-11

reference : shared/design/DESIGN.md §Workspace / docs/DESIGN_SYSTEM.md DS-01, DS-02, §5 — native controls, content hierarchy and explicit actions; reviewed 2026-09-11. Apple HIG text-fields/buttons URLs were fetched but yielded no readable guidance, so no unsupported external rule is attributed.
hypothesis: A request composer with visible submission, persistent drafts and copyable replies, actionable task history, and service-first connections will remove observed dead ends without changing the established color, radius or shadow system.
measured  : Actual signed app Home at 1162×768pt: single-line 48pt field, 0 visible send buttons; Work rows are static views with 0 detail actions; 14 manifest tiles open before service connections; sidebar account text is hardcoded ui-check. Four zero-valued pressure bars occupy a full Home section. Main minimum size is 940×620pt.
candidates: A = current; B = multiline 84pt editor + existing 28pt controls, 3 recent tasks before secondary context, native task detail and search, 2 provider groups with implementation details collapsed, settings entry; C = new dashboard/marketplace and invented demonstration results, rejected because unsupported by current execution capabilities.
gate      : Behavior first: preserved draft across navigation, explicit nonempty submission, single in-flight request, no side effects from history, keyboard-operable controls; then native light/dark/minimum-window screenshots and geometry, existing Swift/golden/occupation checks, verify-all before any commit. No new external API calls are needed for fixtures.

## Audit observations

- Test artifacts exist in the user's data store; preserve them and all recordings. Run this round's fixtures under a separate ASTRA_DATA_ROOT.
- Home input is cleared even when authentication is unavailable. Two submissions can race in VoiceHUDState.
- Tasks show percentages even for terminal states, have no selectable detail, and do not refresh while visible.
- Apps is showing internal plugin manifests as its first experience. Several apparent connections have no connect action.
- The Library subtitle claims audio never leaves the device, contradicting an explicitly enabled cloud live transcription setting.

## Scope

Improve the existing request, task-inspection, connection and recording-navigation journeys. This round does not claim that video rendering or general artifact production has been implemented. Public release remains subject to the existing complete release gates.

## Follow-up from native interaction

- CUA confirmed Home → Work → task detail → Home retains the multiline draft; detail copy reports completion; an unauthenticated submission keeps the draft.
- Native clipboard paste timed out because the app had no responder-chain Edit menu. Added standard macOS edit commands and will retest paste, selection, undo and submit on the actual fixture.
- Added a labeled recording entry in the main toolbar so long answers/history cannot push every recording action below the viewport.
- Geometry measured the narrow native window at 940×672pt (620pt requested, AppKit/SwiftUI minimum applied), and the ordinary window at 1162×768pt. These are measured sizes, not an assertion of 620pt rendering.

## Adopted Connections density reference

The native `07-apps` capture now opens Connections with the two provider groups specified in candidate B, instead of the previous manifest tile grid. Its measured background fraction is 64.2% (previous grid 45.5%). The screenshot was visually inspected: both provider groups, service names, connection state, settings and the advanced disclosure are visible without clipping. Adopt 64.2 only for `07-apps` in the density reference; keep the 1.5-point tolerance and every other surface limit. Filling the deliberate reduction in catalogue content merely to match the old grid density would contradict the accepted service-first design. This is a new structural reference, not a measured blind-preference win.
