# Screenshot → AI question · 2026-09-11

reference : Apple Screenshot, https://support.apple.com/en-ie/102646 (accessed 2026-09-11): a capture thumbnail is an immediate, clickable next action; Astra uses the existing Dock rather than adding another overlay.
hypothesis: Replace the screenshot chip's generic Quick Actions destination with an explicit 「AIに尋ねる」 action, opening the existing Home composer with the chosen image and keyboard focus. This removes the intermediate menu and prevents later captures from changing the question's image.
measured  : Current screenshot Dock is 320×52pt (voiceHud.contextWidth/contextHeight); reaching text input requires screenshot → Open → Home as needed. Home editor is 84pt high, content width 760pt. No image preview or explicit selected attachment is shown there.
candidates: A = current generic menu; B = one click into Home with a fixed image preview and unchanged 320×52pt Dock; C = another floating screenshot question window. Choose B for this user-requested journey; C adds a second input surface.
gate      : Native light/dark captures and geometry at Compact/Comfortable/Large, detection→CTA→focused composer, selected-image stability across another capture, remove/cancel without submission, new-conversation attachment retention, missing-image failure, screenshot context regression, Swift tests and verify-all. Capture/CTA alone must make zero AI calls. No blind-panel claim is made.

## Ask what the user wants to know, 2026-09-12

reference : User clarification: taking a screenshot usually means the user has a question about it. Astra DESIGN.md §0 retains the existing Dock and Home input surface.
hypothesis: make 「この画像について質問」 the single primary capture action. It opens an attached, focused composer; the user supplies the question before any inference. Remove the competing automatic-explanation route and duplicate question icon.
measured  : current offer is 320×52pt; explanation is primary, custom question is an icon. The existing Home editor is 84pt high and already supports a pinned image preview and unsent text.
candidates: A = one-click generic explanation; B = same 320×52pt offer with question + dismiss, context-specific Home heading/placeholder, no generated prompt; C = open a new input window on every capture (rejected: steals focus and duplicates surfaces).
gate      : native capture → question action → focused preview/input with zero new inference requests, user-written question → one answer; second-capture image stability, removal/draft preservation; three-scale light/dark native goldens and geometry, Swift suite and UI/privacy gates.

## Physical keyboard handoff, 2026-09-12

reference : User report at 00:23: the composer looks focused but typing fails. Apple AppKit NSApplication.activate documents asynchronous activation; NSWindow key/main ownership is distinct from SwiftUI focus.
hypothesis: finish the nonactivating Dock button event before activating and focusing the regular question window; focus must follow the window’s actual activation, not only its TextEditor binding.
measured  : production is an accessory application. The reported window had a focused-looking composer while the menu bar still identified the other app; selecting Home via the Window menu restored Japanese key input. Previous AX setValue verification bypassed the keyboard route.
candidates: A = synchronous makeKeyAndOrderFront followed by activate; B = defer explicit handoff past the Dock event and establish key ownership after activation; C = replace the text editor (rejected unless keyboard events reach it and fail there).
gate      : isolated accessory-mode app using the real Dock and Home, physical key events with no AX setValue, Latin and Japanese marked-text/commit, close/reopen and repeat captures, native input logs and Swift regressions. User’s live draft remains untouched.

result    : Adopted B with the existing foreground activation request retained. A polite-activation-only candidate accepted targeted Latin key events while staying inactive and failed Japanese IME, so it was rejected. The accepted candidate acquired Home key ownership and Japanese marked text; repeated capture/reopen kept the committed draft and accepted additional keys. No dimensional change.
