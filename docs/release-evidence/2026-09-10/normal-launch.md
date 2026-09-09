# Normal launch verification — 2026-09-10

The notarized `967ba82` distribution passed its artifact selftests but stalled during a real normal launch on this Mac. Process sampling over several minutes found the main thread blocked in `FileManager.contentsOfDirectory` during startup. Computer Use could not obtain the app's UI.

Screenshot-directory enumeration and watch installation now run on the watcher's serial utility queue, as do subsequent directory scans. Failure to establish the initial directory baseline does not classify pre-existing files as new screenshots. Stop does not wait for blocked filesystem I/O. A generation check prevents queued folder deliveries and stability retries from an old run from ingesting after stop/restart. This correction does not claim to move every file operation off the main thread: file classification and cache cleanup remain separate existing paths.

Validation before commit:

- 69 Swift tests pass, including an intentionally blocked directory reader that leaves the main thread and stop responsive.
- The real screenshot-context gate passes: watch-to-ingestion 54ms in this sample, no duplicate or partial-file ingestion, no focus change and no image transmission before explicit attachment.
- A freshly built Developer ID app launches normally through Computer Use. Clicking the Dock, then “開く”, displays Home and its accessible controls. The earlier stuck test process was terminated; no OS permission database was modified.
- Independent read-only review found no new blocker in this bounded correction.

VoiceOver was temporarily enabled, its first-run tutorial handled and its process observed running. Computer Use still timed out when retrieving the VoiceOver output/caption surface. Therefore no complete spoken-output journey is certified. VoiceOver was restored to OFF. Microsoft consent screens were recreated after the previous temporary tabs closed and are retained for the pending data-access approval. No additional test email was sent.

The complete common verification and the matching release artifact must pass for the corrected source. Release remains NO_GO while the other recorded live gates remain unverified.

Final current-source common verification: **VERIFY_ALL_OK**, 69 Swift tests, both golden comparisons, geometry, all three journeys and recording crash recovery PASS. Real microphone startup measured 186ms in this sample; the UI remained “preparing” until capture was live.
