# Genie rename validation

2026-09-13: `scripts/verify-all.sh` completed with `VERIFY_ALL_OK` after renaming the product.

- Rust core: 42 tests passed. Tauri Rust: 67 passed, 3 ignored.
- Desktop: 352 tests passed. Swift: 151 tests passed. Agent host: 192 tests passed in the targeted suite.
- C ABI, C# bridge and C# logic gates passed. TypeScript build/typecheck and formatting passed.
- Current light/dark golden images and six measured geometry states passed with unchanged thresholds.
- JA, JB, JC journeys passed without additional windows or stolen focus. Raw current captures are stored beside this report; historical Astra captures are retained.
- Local Ollama completed the native AI action, translation, and voice-question fixtures. No paid model was used.
- Permission-dependent live microphone, speech, screen capture and accessibility fixtures were explicitly skipped where the isolated development app lacked authorization. They are not asserted as passed. Synthetic recording and interrupted-session recovery passed.

This report validates the naming change within the available local environment. It is not a full production release approval. Signed distribution and GitHub CI evidence are attached to the PR/release.
