# Permission help — 2026-09-11

Historical record of the preceding artifact. The next [capability-led permission round](../permission-capabilities/RESULTS.md) supersedes its bulk-menu flow and always-visible file helper.

The guide was already implemented under `GuidedSetup`, reachable through the status-bar menu. Settings bypassed it for microphone/screen/accessibility, the ordinary application menu omitted it, and the retained Settings view did not refresh after returning from System Settings.

This change connects those entry points to the existing guide. Each permission row selects only that permission; the general guide retains its existing three-permission scope (accessibility, screen capture, microphone). Speech, calendar and input monitoring keep their separate purpose-specific OS controls. Completion wording now refers to the permissions in the current guide instead of implying that every OS permission is granted.

When guiding accessibility or screen capture, the card offers the **running bundle's exact file URL** for user drag-and-drop. Clicking it reveals that same bundle in Finder; it does not assume `/Applications/Astra.app`. Only an existing local `.app` directory is offered. No OS switch is changed by this code. OS APIs, rather than the switch's appearance or the user's acknowledgement, establish completion. The existing fallback stays unanchored when AX cannot read the target; no guessed pointer is shown.

Also fixed: microphone fallback incorrectly mentioned screen recording; retrying a failed Settings launch did not resume detection; duplicate/stale success callbacks could affect a restarted guide. The file-add help disappears on success and when the user closes the guide.

Validation:

- 115 Swift tests passed, including exact drag URL/type, individual permission scope, missing-target copy, actual-menu wiring, switch-appearance versus OS state, duplicate/stale callbacks, and retry without another permission prompt.
- Eight native light/dark captures are in `docs/golden-screenshots/permission-help`, with measured geometry. Settings remains 460 × 620 pt, the guide retains its 300 pt content width and measured height. Permission changes in these fixtures are simulated; no OS access is granted or requested. The same retained Settings view visually refreshes after app reactivation.
- UI taste and purpose-specific permission gates passed. The existing one material background was re-reviewed; no allowance was increased. The full `verify-all` run recorded AX insertion failure and an initially expired UI material review / long-copy failure. The latter were corrected and their specific gate rerun; this is **not a claim that the aggregate became green**.
- Recording crash recovery and JA/JB/JC native journeys passed in that aggregate run. Real `AXIsProcessTrusted` remained false. No commit is made while `verify-all` is not green.

The final bundle's real Settings → guide → System Settings / Finder journey is recorded after packaging in `dist/release-validation/permission-help.json`. A payload unit test does not establish that the user has dropped the app in System Settings or granted it access.
