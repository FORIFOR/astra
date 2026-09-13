# Liquid voice orb — 2026-09-13

reference: User-selected [Liquid Orb Editor](https://lersent001.github.io/orb/) Siri glass preset; upstream MIT Metal/WGSL export, pinned in shared/design/liquid-orb/README.md.
hypothesis: One compact glass orb makes thinking, microphone input and spoken output recognizable across the existing surfaces; state text remains authoritative. This explicit user request supersedes the old static-dot/no-gradient guideline for the orb only.
measured: Native indicator is 9pt; thinking uses a sparkle and listening also shows a fixed six-bar sample. Existing listening dock has 600pt width/120pt cap; thinking 560pt/88pt cap, with 20pt horizontal and 16pt vertical padding. Tauri already supplies real input/output meters to its orb.
candidates: Keep 9pt dot (reference detail illegible); 36pt orb inside the current dock (26pt visible sphere plus transparent breathing room); 64pt orb (unnecessary dock growth). Implement 36pt, retaining the compact idle entry and existing controls.
gate: Native and desktop state/meter/lifecycle tests; real Metal render captures in light/dark with geometry; microphone first-frame distinction; real playback start/stop; Reduce Motion and hidden-view pause; verify-all.sh before commit. No API call is made for rendering.

## Review

Implemented and visually reviewed against the user-selected preset in real Metal and WebGPU. State text and existing controls remain authoritative. No independent review or product-wide release-go claim is implied.

## Native fit refinement

reference: The same user-selected glass orb; preserve the existing Agent task surface and occupancy ceiling.
hypothesis: A 22pt header orb fits a dense multi-step task while the primary voice/thinking row retains 36pt.
measured: 36pt Agent header grows the 3-step Dock to 720×343pt, exceeding the 720×330pt limit by 13pt; listening is 600×100pt within its 600×152pt safe-top limit.
candidates: Enlarge the whole task panel; compress all text/spacing; use 22pt for the Agent header alone. Select the last to retain readability and controls.
gate: Re-measure the Agent Dock and verify occupation without raising its ceiling; update only its geometry.

## Measured validation

- Agent Dock: 720×329pt after compact-header refinement; all seven occupation surfaces pass without increasing ceilings. Listening: 600×100pt.
- Native display link: 23 real frames in the 800ms observation window. Configure-before-show, automatic hide pause, reopen resume and Reduce Motion are tested without manually refreshing playback. Window visibility observation fixes the missing ordering notification in capture sessions. Playback start, finish and explicit cancellation pass.
- Native visibility follows ordered-visible/minimized/hidden/detached state. Strict occlusion gating is intentionally avoided because remote desktop/window capture can report an empty occlusion state while displaying the window. Fully covered, ordered-visible windows may continue rendering.
- Six focused Swift tests and 19 focused desktop tests pass; WebGPU thinking and speaking paths visually inspected. Native fallback is a captured frame from the same Metal shader.
- Final full regression: `VERIFY_ALL_OK`. Native Swift 157, desktop JS 357, core Rust 42, Tauri Rust 67 passed. Three journeys pass. Permission-dependent live capture checks remain explicitly skipped for the development-signed test app; this is not a product-wide release-go declaration. See verification.txt and journeys/.

## Density baseline adoption

The fixed six-bar MiniWaveform was decorative and never reflected captured audio. It is removed; the requested 36pt orb now reflects the actual meter. Listening background pixels measure 94.1% versus the old 92.6%. Under DESIGN.md §4, adopt only this surface after reviewing the removal in light/dark captures. The panel is 600×100pt, inside its unchanged ceiling; the 1.5pp regression tolerance and other density baselines are unchanged.
