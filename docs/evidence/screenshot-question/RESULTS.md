# Screenshot → user question, 2026-09-12

The capture offer’s primary action is 「この画像について質問」. It opens Home with the chosen screenshot, keyboard focus and a context-specific prompt. No generated question is inserted, and the capture/entry action performs no inference. The user types what they want and explicitly sends it. The former generic-explanation flow and duplicate custom-question icon are removed.

The selected image remains fixed while another screenshot is taken; unsent text survives navigation and attachment removal. The previous Quick Actions visibility fix remains in place.

Checks: 130 Swift tests; 18 native captures across three scales and light/dark (including entering from Quick Actions); geometry for six states and occupation for seven surfaces. Native captures and geometry are in `docs/golden-screenshots/screenshot-question/`. UI taste, privacy, permission JIT, type scale and token freshness are verified separately. These focused checks do not replace the product-wide release decision.

Final signed-application capture → entry with zero requests → typed question → answer observations are stored in `dist/release-validation/screenshot-ask-native.json`; the verified Downloads artifact is recorded alongside it.

## Keyboard input correction, 2026-09-12

The earlier live check set the AX value and did not establish that hardware-style key events reached the editor. The user's report exposed that gap. Selecting Home from the Window menu restored input on the running old app; its unfinished draft was left intact.

The explicit Dock → main-window handoff now runs after the Dock button event, keeps the existing foreground activation request, and finishes only when Astra is both active and the frontmost process. A pending activation expires after one second, and hide/suspend cancels it. Screenshot focus is requested again after that handoff. An already-editing NSTextView is left alone so selection and marked text are retained. A stale SwiftUI focus flag is reset only for a new explicit focus request. No appearance or dimensions changed.

The isolated `--selftest screenshot-input` keeps production's accessory activation policy, records only its own temporary draft/key events, and has no backend connection. CUA key presses (no AX setValue) verified Japanese marked text 「あす」, Return commit, newline, conversion to 「日本」, and a second detected capture reopening the same draft with further 「てすと」 input. The selected image changed only on the next explicit question action; request count stayed zero. Raw receipts are in `dist/release-validation/screenshot-input-native.json`.

An intermediate candidate using the newer polite `activate()` call failed the actual foreground/IME check and was discarded. Merely observing Latin text via targeted automation was insufficient: the accepted candidate also reports the real key window, first responder and Japanese marked text.
