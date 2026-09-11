# Screenshot → one-click explanation, 2026-09-11

reference : Apple screenshot workflow (https://support.apple.com/102646, existing screenshot-question round) and Astra DESIGN.md §0: keep the capture offer on the existing surface and require a deliberate action before inference.
hypothesis: replace the composer-only primary action with an explicit 「画像を解説」 action; keep a secondary custom-question action. A captured image should need one click and no typed prompt to produce a real answer.
measured  : existing context Dock is 320×52 pt (tokens), normal idle is 220×44 pt; current primary opens Home and requires typing plus Send. HTTP/local model requests currently omit image bytes.
candidates: A = current 320×52 composer entry; B = same 320×52 with explanation primary and custom-question secondary; C = automatically invoke a model for every capture (rejected: accidental disclosure and recurring inference cost).
gate      : native captures at all three interface scales in light/dark; duplicate/cancel/disconnect tests; real ⌘⇧3 followed by a real vision answer containing information present only in screenshot pixels; isolated verify-all before commit.

## Capture while the Dock menu is open, 2026-09-11

reference : Astra DESIGN.md §0 / DS-01, and the user’s 2026-09-11 23:47 screenshot: one existing surface must expose the action relevant to the newly captured image.
hypothesis: a new screenshot should replace the passive Quick Actions menu with the existing explanation offer; active input, confirmation, recording and running work retain their controls.
measured  : current offer guard accepts idle only; native AX confirms quick-聞く / quick-録音 / quick-開く. The existing offer uses 320×52 pt plus the display safe inset.
candidates: A = keep the menu and hide the capture action; B = transition passive idle / Quick Actions / collapsed app context to the same 320×52 offer; C = add another popup (rejected: duplicate surface).
gate      : reproduce with a standard macOS capture while Quick Actions is open; regression tests through image ingestion, protected-state preservation and zero unsolicited inference; native golden and geometry; signed app capture-to-answer verification.
