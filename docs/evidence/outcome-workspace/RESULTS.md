# Outcome workspace — 2026-09-11

## What changed

Home now starts with one editable request, three writing starters and three recent jobs. Meeting/context details are disclosed on demand; active recording and the latest interrupted meeting remain directly accessible. The new result view keeps the output, its status and the original request together. Copy and Markdown export use the saved result. Reopening or refreshing an accepted job reads its existing backend ID and never resubmits it.

A request and its backend/result record are saved atomically in SQLite. Existing task history is still readable. A failed, cancelled, empty or clarification response is not shown as a completed deliverable. Work search includes the original request and output.

## Evidence

- `live7.log`: real Home/VoiceHUD execution through the local gateway, Temporal worker and qwen2.5:7b host produced 1,977 characters. The result was reopened from SQLite in another process and exported identically.
- Native computer-use check: opened that persisted result, copied its body, pasted it into Home, saved it through NSSavePanel to `/tmp/astra-outcome-ui-export/Astra-0D89951D.md`, and compared the saved bytes with the deterministic export (identical). No new model request is made by these operations.
- `native-workflow.json` / `announcement-result.md`: native Home submission of supplied review facts now returns one usable announcement with the requested date and three checks, without invented URLs or signatures. The earlier prompt overemphasized multi-option creative drafts; it now follows the requested format and defaults to one text.
- `local-model-draft.md`: the actual unedited result. This is evidence of functioning execution, **not** a claim of strong creative quality. Its three proposals remain too similar and some instructions are imprecise. No video was produced or published.
- `docs/golden-screenshots/outcome-workspace`: 32 native captures, light/dark, 940pt and 1162pt width. The narrower window has a native 672pt minimum height. These are offline fixtures, not model-generated output. No blind comparison panel was run.
- Six geometry surfaces, seven occupation ceilings, type-token checks and 104 Swift tests passed during the round. The final aggregate result is recorded below.

## Bugs found through actual use

- Written deliverables were routed to an unsupported external action. Composition now remains a writing operation; explicit outward actions retain their separate path. An unidentified creation request falls back to conversation rather than implying an external action.
- Long request text replaced the task title, exceeding the GET task contract. Titles are bounded without truncating the actual request.
- Small local models in forced JSON mode could emit invalid JSON or tiny fragments. Prose uses one plain-text generation and is wrapped by application code; structured operations retain structured output handling. Empty/truncated responses fail visibly.
- General answer/compose steps now have the same single-attempt treatment as other metered operations, with a Temporal patch for old histories. There is no extra hidden critique request or automatic paid-model fallback.
- Some older acceptance checks treated error text as a successful answer or required a second upload after recording, contrary to the live-only requirement. Checks now require the real saved answer, or a real microphone recording persisted to the local library. Visual fixtures no longer authenticate on every render. Prepared test credentials can be reused without weakening production rate limits.
- Three scripts killed every running Astra process. They now wait for their own test instance or terminate only their own PID.

## Scope and limits

This delivers a durable native writing workflow. It does not add a video renderer, arbitrary website deployment or trading execution. Generated text still needs review. The local gateway, worker and host are prerequisites on this PC; a distributable app is not evidence that those services are hosted for other users. Current UI checks do not replace VoiceOver/Windows/live-provider or independent product-wide release review.

## Final validation status

- `verify-all.log`: **VERIFY_ALL_FAIL**. Developer ID candidate recorded 5,000 ms from the real microphone and saved the same meeting as ready in the local library. E2E-001 then failed at its accessibility text-insertion step (`inserted=false`); the aggregate therefore remains red. No commit or product-wide release-go claim is made from this run.
- 104 Swift tests, Rust/core and desktop regressions, type checking, 29 host tests and 10 routing tests passed. The three JA/JB/JC journeys passed.
- The preceding full run also passed both sets of 10 strict screenshot comparisons, six geometry checks, seven occupation limits, 16 density checks, and the session/Dock state captures. The changed Connections density reference is justified in the workspace UX design round; other limits and tolerances were preserved.
- Some permission-dependent checks are skipped by individual app identities. A skip is not evidence of that interaction succeeding. The external text-insertion failure and remaining independent product-wide gates still prevent `release=go`.

The own-process Calendar guide inspector could read menu/toolbar nodes but not the Home SwiftUI subtree on this launch. It now reports that measurement as skipped instead of treating the presence of menu nodes as proof that Home controls are absent. It still fails if Home is readable but its disclosure or permission reason is missing.

## Packaged app check

The notarized app was launched under the user's normal data root and identity. A real local-model request moved from Home to Work and produced its saved document. The host's 15-minute access token expired during verification; after reauthentication the **same** backend job completed, and the native Refresh button retrieved its output without resending. Automatic credential renewal remains an additional release blocker. The worker was reconnected for this session; this is not a claim of persistent production hosting.

Computer Use on the signed app opened Home's meeting disclosure and found the recording action, recovery controls and Calendar permission reason/button. The disclosure was also given a containing accessibility element so its identifier no longer overwrites the identifiers of its child controls. Existing recordings were preserved.

## Follow-up — session renewal and provider quality

The later [session and writing round](../session-and-writing/RESULTS.md) implements automatic renewal, process exclusion, safe interruption handling and explicit provider selection. Its real gateway checks pass. The remaining native end-to-end failure is accessibility text insertion. The supplied video brief passed a manual review through Codex; local creative results remain insufficient. See the follow-up's unedited outputs and final aggregate log for the current limits.
