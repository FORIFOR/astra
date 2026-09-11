# Recording options keyboard verification — 2026-09-10

With Full Keyboard Access enabled on the notarized `643bc69` app, keyboard traversal and Space opened recording options, but pressing Escape twice left them open. The system-audio toggle and three pickers also exposed values without accessible names.

The cancel button now declares the standard cancel keyboard shortcut. Toggle and Picker receive their existing visible row names while retaining hidden labels, so layout and persistence do not change.

In a freshly signed Developer ID app, with Full Keyboard Access ON:

- AX exposes the four control names: 画面の音, テンプレート, 保存先, プロジェクト.
- Escape closes recording options and returns to Home with the start-recording action available, without starting a recording.
- Full Keyboard Access was restored to its original OFF state.

All 69 Swift tests pass. Independent read-only review found no new blocker in these small semantic changes. This closes the observed recording-options defects; it does not certify every keyboard or spoken VoiceOver journey. Matching common and distributed-artifact validation is recorded separately.

Final current-source common verification: **VERIFY_ALL_OK**, 69 Swift tests, both golden comparisons, geometry, all three scripted journeys and recording crash recovery PASS.
