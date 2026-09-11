# Screenshot explanation — 2026-09-11

Superseded UX on 2026-09-12: the user requested a custom-question entry point. The primary capture action now opens the image-attached composer; the generic one-click explanation route has been removed. See `../screenshot-question/RESULTS.md`. The historical tests below document the image transport and previous route.

The compact capture offer now starts an explanation with one explicit click. The secondary speech-bubble action opens the existing composer for a custom question. Capture itself causes no inference. Unsent Home text is preserved. Duplicate clicks, cancellation, missing images and unavailable connections have covered recovery paths.

HTTP and local models now receive actual PNG bytes as multimodal message parts. Only answer/compose receive selected images. Missing, escaped, non-PNG and oversized attachments fail before inference. A request is bounded to four images / 20 MiB and the existing output-token ceiling; redirects and automatic provider retries are disabled. Image text is treated as source material, not instructions. The adapter uses the [Ollama OpenAI-compatible image interface](https://docs.ollama.com/api/openai-compatibility).

## Observed native journey

The macOS Screenshot utility saved a real full-screen PNG to the user's configured screenshot folder. Astra detected it and offered 「画像を解説」. Clicking it initially exposed an expired local desktop session. The new explicit reconnect action renewed that session without dropping the selected screenshot. Work then displayed a real answer from the installed `qwen3.5:9b` local vision model. The answer included `VX-Q7M2`, which was in the image pixels and absent from the submitted prompt. The request-to-saved-result time was 28.833 seconds; the result was visibly confirmed at the 32.5-second observation after reconnect. See `native-verification.json`.

The system Cmd+Shift+3 shortcut is enabled and uses this same standard save path. CUA's synthetic shortcut did not trigger macOS capture; the actual test used the standard Capture control instead. This evidence does not claim successful automated shortcut-key injection.

The direct vision-adapter test took 22.8 seconds including model loading. Both tests used loopback Ollama; no paid model API was invoked. The actual desktop PNG is not checked in because it includes the surrounding desktop.

## Runtime repair on this Mac

The existing local gateway/worker/host were stopped. Their existing configurations remain in `~/Library/Application Support/Astra/`. The host is now configured for the installed local vision model. Local launch agents (`com.astra.local.gateway`, `.worker`, `.host`) keep these services available across login/process exit. A persistent local signing identity replaces disposable gateway signing keys, which previously invalidated sessions on each service restart. Credentials and keys are not in this repository.

## Checks

- Swift unit tests: 131 passed, including explicit reconnect, duplicate clicks, image pinning, cancellation and draft preservation.
- Agent host: 184 passed, including multimodal payload bytes, missing/symlink escape rejection and inference request limits.
- Native visual captures: 18 at three interface sizes, light/dark, with geometry in `docs/golden-screenshots/screenshot-question/`.
- Full verification: the initial run failed the live AI-action gate because its random test identity had no agent host. The re-run used a dedicated test identity and local host and ended `VERIFY_ALL_OK`. Environment-dependent mic/dictation gates still report their explicit skips; this is not a product-wide release approval. See `verify-all.log`.

## Follow-up: a capture hidden behind Quick Actions

The user’s 23:47 screenshot showed the passive Dock menu instead of the explanation offer. A real full-screen capture at 23:53 reproduced this in the running signed application: the image was detected, but the offer appeared only after Escape. The coordinator previously accepted only idle presentation. It now returns idle, Quick Actions and collapsed app context to the existing offer; expanded context, active input, recording, confirmation and task controls remain intact. No image is submitted by this transition.

The added regression failed on the old implementation (menu retained, 560×36 instead of 320×52), then passed after the fix. The current Swift suite has 133 passing tests. The native screenshot-question fixture now starts each of its six offer captures from Quick Actions; all 18 captures pass. Geometry (six states), occupation (seven surfaces), shape, UI taste, privacy egress, permission JIT, type scale and design-token checks pass. Full verify-all above belongs to the preceding baseline; this follow-up uses the listed focused checks and does not claim another full release decision. Final signed-app and package observations are kept in dist/release-validation/screenshot-menu-native.json and screenshot-explain-artifact.json.
