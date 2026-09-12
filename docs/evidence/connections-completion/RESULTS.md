# Connections completion — 2026-09-13

The native Connections screen now offers one Google Workspace connection and one Microsoft 365 connection. Each has a purpose preview, actual included services, account identity, verified status, cancellation, recovery and provider-wide disconnect. Unsupported catalog entries are not presented as connectable.

## Implementation

- Publisher-owned native OAuth parameters load from bundled `connections.json`, the local Application Support file, or explicit environment overrides. Finder launch no longer requires shell variables. Only the allowlisted client parameters are packaged; access/refresh tokens remain in Keychain.
- Google desktop exchange includes the matching native client parameter. Microsoft uses separate read/send clients and explicitly asks which account to use.
- PKCE callbacks bind to IPv4 loopback, validate path/state and single-use parameters, tolerate unrelated requests, and have bounded startup/authorization waits. Listener startup is asynchronous; a real HTTP test caught and removed the previous main-queue wait deadlock.
- A connected badge requires both a usable matching local credential and an active server record. Partial grants only connect the services actually permitted. Failed persistence restores the prior local credential. Disconnect covers read and send records and exposes failure/retry.
- Initial Profile can run when continuous work sync is disabled. Failed reads have a stopped-state heading, Keychain guidance and a way back to Home; opening the existing profile does not restart extraction. It performs a bounded metadata read, without model classification calls. Confirmed profiles open their existing review surface.
- Local worker refresh loads the same publisher configuration. A blocked Keychain read times out with a recovery message rather than leaving a job waiting indefinitely.

## Verified

- Native connection tests: combined consent, partial consent, unexpected write permission, rejected/wrong-state callback, registration rollback, local/server disagreement, offline status, cancellation, disconnect retry, real loopback HTTP and config precedence.
- Google: normal signed-app launch → purpose preview → existing authorized account → real OAuth → Gmail + Calendar connected, with account label. Quit/relaunch retained verified connection status.
- Microsoft: normal app → purpose preview → account chooser → specified Outlook account. The real callback remains pending user passkey authentication; do not count this as a completed Microsoft live test.
- Initial Profile: explicit request reached the live worker with continuous sync OFF. Provider read requires the user's macOS Keychain approval. The new timeout reached a visible failed/retry state; successful data extraction is not yet asserted.
- Send authorization cannot relabel the separate read account in Connections.
- Eight Initial Profile native captures cover analysing, ready, editing and failed states in both themes. The failed-state buttons were invoked to verify defer/reopen without another read.
- Four native captures at actual content sizes 940×672 and 1162×768, light/dark. Both provider actions and the advanced disclosure fit in the minimum captured view. See `docs/golden-screenshots/connections-completion/geometry.json`.

## External limits

Google currently identifies this OAuth application as a testing/unverified app. This Mac's configured test account can connect. Successful local testing does not establish unrestricted public OAuth availability. Microsoft passkey and OS Keychain consent require user action. No test mail was sent by this work.

The first complete verification run found an obsolete static privacy check expecting service-level button calls and an AI fixture without a matching live host. The check now verifies the provider-purpose button and the separate send confirmation. The AI fixture uses a test access token for the existing local host identity; credentials are temporary and excluded from the repository.

## Validation result

- `scripts/verify-all.sh`: **VERIFY_ALL_OK** (2026-09-13, local macOS), including **144 Swift tests with zero failures**, native Profile defer/reopen and recording/session journeys.
- Focused Connections journey suite: **14 passed**; configuration regression suite: **3 passed**.
- `pnpm --filter @astra/worker-agent-host test`: **186 passed**.
- OAuth suite: **49 passed**; `pnpm typecheck`: passed.
- Rust connector tests: **11 passed**, including a local HTTP token exchange with PKCE and Google native client parameters.
- Privacy egress, current generated bindings, design token checks and UI gates passed.
- Full verification uses isolated fixture data and a temporary token for the existing local host. Local AI runs do not incur external model API charges. Fixtures are not evidence of completed provider authentication.
- Some frame-pacing samples did not reach 60 fps and remain `NOT_MEASURED`; the script's unmeasured external/platform conditions are not promoted to passes. Google profile data extraction and the Microsoft live callback remain pending as described above.

Private client configuration and test access tokens are excluded from Git. Native screenshots use fixture accounts/data.
