# Recording and live translation journeys — 2026-09-11

Candidate: `codex/release-go`, based on `3e81017` plus the current working tree. macOS 26.6.2, MacBook Pro, 2× display with 32pt camera safe area. These are local validation results, not a product-wide release approval.

## Changes prompted by actual use

- “ライブ” is now “大きな字幕”: both it and “原文” show live speech; the former emphasizes recent text, the latter keeps speaker/time context.
- Selecting “翻訳” starts sequential translation of confirmed utterances. New speech is processed automatically. Japanese/English selection, auto-update and retry live beside the results. Original words and timestamps remain available.
- Language switches, cancellation and a new recording invalidate old requests. A retry retains completed rows and processes the remaining utterances.
- Translation has a dedicated read-only client, avoiding generic task routing, absent agent-host processes and missing plugin installations. Local translation uses this Mac's Ollama. Explicitly configured compatible APIs can be selected separately; there is no automatic external fallback. Redirects and unencrypted external endpoints are rejected.
- The native popup picker did not open in the nonactivating Dock during mouse testing. Replaced it with two directly clickable language buttons, with 32pt hit height. Added accessibility containers so each control retains its own identifier and label.
- Actual Google text now ends the “準備中…” state even if a separate level callback has not arrived.

## Validation

`result.json`: 18 passing assertions from the signed app launched by LaunchServices. Synthetic Japanese speech was streamed through the actual local Gateway → Google STT connection and translated by the actual local Qwen2.5:7b before recording stopped. No production meeting was recorded or sent by these tests. Storage was isolated under `/tmp/astra-translation-review`.

The journeys cover selecting translation before speech, receiving live text and translation, original/large-caption/translation switching, automatic translation off while original transcription continues, catching up when re-enabled, stop/save, and a new recording with clean state. Same-language selection preserves the original English verbatim rather than asking the model to rewrite it.

Mouse checks in the running app additionally verified Japanese → English → Japanese selection, selected-state labels, automatic update off/on, original/large-caption/translation tabs, and opening the detached workspace with the same translation state. The earlier invalid-translation state exposed a working retry button. Actual offline/backlog recovery and stale-request rejection are covered by deterministic coordinator tests; real network disconnection was not introduced to this Mac for translation.

`quality.json`: eight synthetic short utterances, both directions, checked for date/time (including AM/PM), negation, quantities and microphone terminology. Qwen2.5:7b was installed locally for comparison with the user's Llama3.2; the final native sample completed in about 0.38–0.68 seconds per utterance after model load. The initial cold model load in the earlier comparison took about 16 seconds. These figures exclude speech-finalization latency and are not a benchmark for long natural meetings.

Llama3.2 initially produced malformed Japanese, omitted a month, and mistranslated muted audio. Its comparison output is preserved in `llama3.2-comparison.json`. Qwen also exposed an already-English rewriting error during mouse testing; the final client avoids that call and rejects confidently detected wrong-language results. Original text remains visible because model translation can still make mistakes.

Swift regression: 86 tests passed, including 11 translation lifecycle/HTTP tests. The new checks exercise unfinished speech, incremental finals, late uncancellable responses, language/engine switching, same-language bypass, retry/backlog, new-session reset, malformed/truncated responses, endpoint restrictions, server/redirect failures and long input without dropping its tail. HTTP protocol tests use a fixture server boundary; a real external translation API was not tested.

Native captures and measured window sizes: `docs/golden-screenshots/live-translation/`. Light/dark suffixes identify the requested application appearance; the Dock intentionally retains its dark surface in both. The detached workspace was also inspected interactively. The apparent “準備中…” in the second fixture is expected: it contains injected text and no audio capture. The actual first Google speech journey exits that state.

Earlier recording journeys and actual microphone/system-audio/pause/resume checks are in `../recording-journeys/RESULTS.md`. Zoom/Teams real calls, OS permission revocation/recovery and long natural meeting accuracy were not newly completed by this translation run.

## Full regression

The full run passed Rust (38), Tauri Rust (67, 3 ignored), desktop JS (352), native Swift (86), guide/design rules, initial-profile fixtures, recording crash recovery and JA/JB/JC journeys. It failed E2E-001 at dictation. A diagnostic launch confirmed `AXIsProcessTrusted=false` despite the fixture text field being editable; this is not a successful accessibility test. The currently notarized distribution also reported accessibility as unconfirmed while mic/screen permissions were granted. No permission setting was changed.

The old AI-action selftest accepted a failure notice as an answer. Corrected the action to wait for a queued task artifact and only mark a real answer as success; the focused service test now correctly fails on “仕事を始められませんでした。” The local Gateway lacks a working agent task setup for that fixture identity. This is separate from the successful local translation path.

Fresh visual validation captured 16 surfaces in each appearance, compared 10 golden surfaces per appearance within the existing tolerance, and remeasured six geometry states. The newly explicit accessibility containers correct inherited IDs/bounds without changing window size. Latest full-run results are preserved in the validation logs. A passing focused test must not replace failed product release gates. No commit is allowed until the repository's full verification requirement is met.

Final UI follow-up: pending translations now show the original text immediately, including during a cold model load. `translation-layout` produced 12 additional native component captures (320/720pt, light/dark, pending/error/retry). These use an explicitly injected translator to exercise the layout and recovery state; they are not model-quality evidence. All 12 captures and pending-original/error/retry assertions passed. The completed-result captures and actual mouse checks described above remain applicable.

Final full run: `verify-all.sh` remains failed at the corrected AI action gate. It no longer accepts the failure notice as a successful summary. The separate signed-app E2E-001 diagnostic remains blocked by effective accessibility permission. All other completed checks above passed. The follow-up pending-text UI change was built, covered by the 86-test native suite, and rendered in the additional component captures. No `release=go` or commit is claimed.
