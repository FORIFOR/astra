reference : Astra DS-01, docs/DESIGN_SYSTEM.md §1 (2026-09-10): fit the settings window to its content; use the existing meeting transcript surface.
hypothesis: the new explicit audio consent row must be visible in Settings, and a failed cloud pass must offer a retry without discarding live text.
measured  : SettingsView declares 460×620 pt after the added row; SettingsWindowController still constructs 460×540 pt. These are source values, not a screenshot measurement.
candidates: A = existing mismatched dimensions; B = NSHostingView fittingSize; C = another settings window (rejected, unnecessary surface).
gate      : choose B only after native build, screenshots and geometry checks; normal successful Meeting Detail geometry must remain unchanged. No token/color/type/spacing changes.

Native window captures (not ImageRenderer, which cannot render AppKit-backed switches) were inspected in light and dark. Settings 460×620 pt and retry detail 1080×680 pt; labels, switch and retry button fit. Captures and geometry: `docs/golden-screenshots/cloud-transcription/`. Existing 10 stable golden surfaces still match in the verification run. Final verify-all must pass before commit.

2026-09-11 live-only correction (supersedes the final-pass product flow above)
reference : existing TranscriptPanel error text and Settings connection disclosure, DS-01/DS-04.
hypothesis: disclose Google live audio sending and retain a visible failure even after earlier subtitles exist.
measured  : previous Google test received 55 interim results and 1 final before stop; first text 1457ms. Existing failure text appeared only with an empty transcript.
candidates: existing empty-only error; existing panel with persistent error above content (selected); a new overlay/window (rejected).
gate      : keep existing panel bounds and typography; capture Settings light/dark and verify native build and live callback tests. No tokens changed.
