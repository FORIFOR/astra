# Initial profile: one-time onboarding

reference : User-provided three-stage flow (2026-09-09); existing Home/Library grammar in shared/design/DESIGN.md §1 (Apple + Notion: text hierarchy, canvas, hairlines).
hypothesis: Reuse the Home content area for one initial analysis and five reviewable result groups, then return to Home; no new window or persistent Memory surface.
measured  : Existing pageTitle 28, body 16, secondary 14, micro 12; space.large 24, cardPadding 18; no token changes.
candidates: A = existing connection success with no profile explanation; B = connection → actual source counts → five editable result groups in the existing content area (selected by user); no additional onboarding stages.
gate      : Persist once per user; report only completed work; partial/error/restart tests; Swift layout/AX checks and current golden/geometry regression checks before commit. 15–30 seconds is a target, not a fabricated timer or completion claim.

Evidence: six current native fixture captures and geometry are stored under docs/golden-screenshots/initial-profile/. Analysis / ready / editing were visually checked; subsequent captures are byte-identical. The final verify-all run is green (64 Swift tests, both existing golden comparisons, geometry and three journeys). Live account profiling and elapsed time remain unmeasured.
