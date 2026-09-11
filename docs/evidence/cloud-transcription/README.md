# Live-only correction — 2026-09-11

The user requires live transcription only. This supersedes the post-recording behavior described in the historical report below.

- Native microphone and system-audio sources now use separate authenticated Google streaming connections, returning interim/final utterances through the existing live transcript callback and local storage.
- Normal stop drains the current stream only. It does not upload the recording or create a batch task.
- Consent is checked at start and before each frame is sent. The Gateway rejects unauthenticated clients, fake recognizers, oversized frames and unbounded queues. It does not persist audio on this live-only endpoint.
- Native real-time-paced Japanese fixture: 55 interim callbacks and 1 final received **before recording stop**, first text at 1457ms. Apple Speech was not used. This validates the real Google connection with a synthetic single-speaker fixture, not noisy multi-speaker microphone accuracy.
- Route tests: 5 passed (including existing upload receipt checks). Meeting service: 98 passed / 11 skipped. Native unit tests: 72 passed.
- Native streams rotate before the Google five-minute limit. Continuous long-meeting accuracy and long-pause recovery still require dedicated acceptance testing.
- New setting: ライブ文字起こし（Google STT）. Google is used during recording; the setting no longer promises a post-meeting final pass.
- Google streaming limits: https://docs.cloud.google.com/speech-to-text/docs/quotas

Historical implementation record follows; its batch behavior is no longer the normal recording path.

# Google STT native final-pass verification — 2026-09-10

The native recording path previously displayed only Apple on-device speech. Its stop path uploaded audio without retrieving the final transcript, silently ignored failures, and could acknowledge an upload before the server persisted it. Google `recognize` was also being used for entire meetings despite its 60-second input limit.

Implemented:
- Explicit default-off consent; this user's consent is enabled. Recording-start consent and current consent are both required. No automatic upload of historical recordings from ordinary opt-in.
- Native stop → bounded audio WebSocket messages → server persistence receipt → durable final task → local `google-final.json` → Meeting Detail transcript. Live citations remain unchanged.
- Background finalization retains its originating meeting ID and permits the next recording after local audio has closed. Failures retain local audio and expose a retry. Interrupted cloud processing exposes a retry on restart.
- Short recordings use Google synchronous recognition. Longer recordings use a private same-project Cloud Storage object and BatchRecognize, keeping the conversation together. Temporary objects are deleted after processing; the bucket has a one-day deletion lifecycle, public-access prevention, uniform access and soft delete disabled.
- Final rows are persisted in the transcribe step; reconciliation does not transcribe and bill the audio again. The long transcription activity has a 30-minute timeout without an unsupported heartbeat requirement or automatic retries.
- Apple asynchronous recognition errors trigger at most two consecutive retries, then expose unavailability. Live recognition remains on-device; Google is the post-recording final pass.

Evidence:
- Native `--selftest cloudstt` starts a RecordingRuntime session, pushes a PCM fixture, stops locally, verifies completion order and meeting ID, waits for Google, and reads persisted final rows. Passed for 8.37s and 75.29s Japanese fixtures on the local gateway/Temporal worker.
- Pure-provider long test: 75.2895s, 288834ms processing, nine complete fixture repetitions in the returned text. Short test recognized the required content but appended an unspoken “はい”; this is retained in the evidence, not filtered to manufacture a perfect score.
- This is synthetic single-speaker Japanese, not a real-meeting accuracy benchmark. Overlapping speakers, noise and long-duration latency remain unmeasured.
- Meeting service: 98 passed, 11 DB tests skipped. Task service: 41 passed, 15 integration tests skipped. Upload receipt tests: 2 passed (ordered persistence and disk-write failure). Native unit tests: 71 passed before the final capture-only additions; see final verification log for the latest run.
- Native window screenshots inspected in light/dark: `docs/golden-screenshots/cloud-transcription`. Settings 460×620pt, retry detail 1080×680pt.

Local service configuration is outside the repository at `~/Library/Application Support/Astra/gateway-stt.env` (mode 0600). It uses project `astra-production-506721` and an isolated local database. ADC stays in the user's gcloud configuration, not in the app or repository. This local development gateway is not a deployed production service.

API basis: https://docs.cloud.google.com/speech-to-text/docs/batch-recognize and https://docs.cloud.google.com/speech-to-text/docs/sync-recognize .
