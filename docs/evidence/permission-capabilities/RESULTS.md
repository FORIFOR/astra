# Capability-led permissions — 2026-09-11

The user's supplied design replaces the general permission checklist with three capabilities: talk to Astra, understand the screen, and operate Mac apps. This supersedes the immediately preceding `permission-help` round.

## Implemented journey

Home exposes three explicit capability actions. Opening Home or the ordinary/status-bar permission menu makes no OS request. The menu opens Settings, where the three capabilities are primary and speech recognition, calendar and input monitoring are available under “その他の許可”. The existing screen and microphone recording controls retain their separate scope.

For missing access, the existing compact Astra guide first explains the selected capability, with the macOS permission name as supporting information. “あとで” or closing the card cancels the intent. Only the primary Enable button starts the corresponding OS request. While guiding System Settings, ordinary Astra Home/Settings windows are temporarily hidden and restored on exit; recording controls are not hidden. The guide's interactive panel can become key, while callout/highlight overlays remain noninteractive.

The macOS APIs remain the authority. An ON-looking toggle is not evidence of a grant. On detection the guide becomes Ready with an explicit Try button. No microphone, screen read, or control action starts simply because a grant arrived. The grant is checked again when Try is clicked, continuations are consumed once, and cancellation, replacement and stale asynchronous callbacks cannot resume the wrong action.

The application-file helper is collapsed behind “Astraが一覧にありませんか？”. Its drag source contains the exact currently running local `.app` URL. A separate, keyboard-accessible Finder button reveals that file. Neither adds an entry nor changes an OS switch by itself.

Voice and recording entry points wait for microphone permission. Recording has its own explanation and “録音を開始” continuation; an unapproved start creates no recording session. A cancelled guide clears the pending recording intent.

## First use without model charges

The screen practice reads one explicitly requested frame with ScreenCaptureKit, shows a reading indicator, and recognizes Japanese/English text locally with Vision. It excludes Astra's own application windows, uses the main display, performs no network/model call, and drops the preview and text on close. There is no timer or continuous capture.

Control practice finds only the specifically identified text field in the current Astra process, verifies its PID and identifier, uses the existing AX insertion code, and reads the value back. It fails closed instead of writing into an unverified globally focused field or falling back to a different app. This does not claim that every third-party application's input implementation has been verified.

## Validation

- The JC native journey now checks the purpose card, its explicit Enable/Later choices, no premature recording session, cancellation and subsequent synthetic recording recovery. Actual-recording gates report SKIP when the candidate lacks a microphone grant, rather than mistaking the permission explanation for a recording layout.
- The final aggregate returned `VERIFY_ALL_OK`; all three JA/JB/JC native journeys passed. OS-grant-dependent SKIPs remain unmeasured, as described above. The complete log is `verify-all.log`.
- 123 Swift tests passed. New cases cover explanation without OS requests, cancellation, per-permission requests, one-shot continuation, revoked permission, stale microphone replies, window restore, recording-specific purpose and invalid control targets.
- 26 light/dark native fixture captures and measured geometry are under `docs/golden-screenshots/permission-capabilities`. All permissions and practice results in these images are simulated; fixtures use an isolated data directory, no OS grants or external requests.
- Type scale, design-token freshness, purpose-specific permission, privacy-egress and scoped UI-taste checks passed. The existing one material boundary was retained; no allowance was increased.
- The live-test runner now accepts a test-specific result line after diagnostic output while still rejecting nonzero exits and explicit failures. Previously the successful Home/meeting focus check was classified as failed because its focus diagnostics preceded the result.
- The guide-documentation verifier previously killed every AstraMac process before taking its own-window screenshots. That broad kill was removed; guide generation must coexist with the user's app.
- Aggregate, final distribution and live results are recorded after packaging in `dist/release-validation/permission-capabilities.json`. These scoped checks do not establish product-wide release readiness; real microphone/AX grants and existing release blockers require their own evidence. No commit is permitted until the aggregate is green.

Apple API references: [Accessibility trust](https://developer.apple.com/documentation/applicationservices/1459186-axisprocesstrustedwithoptions), [screen preflight](https://developer.apple.com/documentation/coregraphics/cgpreflightscreencaptureaccess()), [microphone request](https://developer.apple.com/documentation/avfoundation/avcapturedevice/requestaccess(for:completionhandler:)).

## Distribution UI follow-up

The first notarized candidate exposed that SwiftUI `onExitCommand` did not receive Escape in the guide panel without a focused control. The guide now uses the existing `escapeKey` key-equivalent path used by Astra panels. The explicit Later button already worked. Final installed-candidate results and provenance are recorded in the distribution receipt.

The post-fix development bundle passed real CUA checks for Escape cancellation and guarded AX insertion into its own `permissionControlField`, with the inserted value read back. A root SwiftUI accessibility identifier was removed because it overwrote identifiers on child controls; the real AX tree now retains the specific field/button identities. The first notarized candidate passed Settings disclosure, Later cancellation and one-shot local OCR of a disposable Japanese/English test document. Its microphone and screen grants were available; its AX grant was not, so development-bundle typing is not evidence of final-distribution AX recovery. The test document was discarded.
