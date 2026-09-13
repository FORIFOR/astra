# Managed local preview — validation

Date: 2026-09-14. Scope: the source-checkout launcher added after v0.1.4; no new DMG or native UI changes.

## What changed

`Start Genie.command` and `node scripts/start-local-preview.mjs` prepare the pinned package manager, dependencies, an isolated Docker database, migrations and restricted roles, then supervise the actual Gateway, Task Worker and Agent Host. They open the installed version-matched Mac app against a separate data directory. The selected installed local model, database, identity, signing keys and results persist across restarts.

Node 22+, Docker Desktop, an installed local model and Genie.app remain prerequisites. This is a developer-preview setup improvement, not a bundled consumer installer or a product-wide release approval.

## Automated checks

- 26 startup/diagnostic regression tests passed locally. They cover invalid and corrupt state, model selection, credential/environment isolation, private files, port conflicts, process ownership, aborts, supervisor loss, redirects and imports through symlinks.
- `scripts/verification/managed-preview-smoke.mjs` passed with a fresh Docker database and the real compiled Gateway, Worker and Host. The local run took 28,326 ms with cached dependencies and container images; this is not a fresh-download timing claim.
- The integration harness uses a deterministic local HTTP model fixture, not a model-quality evaluation. It observed zero generations during setup, exactly one for the submitted task, and no additional generations during stop/restart and artifact reopening.
- A duplicate launcher was rejected without changing saved configuration. The original access token and identical artifact content remained valid after restart. The harness removed only its own disposable Docker project and volumes.
- CI now runs the same fresh-state integration harness in a separate Node 22 / Linux job, in addition to the regression tests.

## Actual Mac and Ollama journey

The signed installed Genie.app v0.1.4 was tested with Ollama `qwen3.5:9b`, a fresh dedicated database and a separate app data directory.

1. The launcher prepared the database and all three services without manual SQL or extra service terminals.
2. The real Home text field accepted a Japanese request for three checklist items with unassigned owners.
3. Sending opened Work and changed from “作成中” to “成果物ができました”. The generated result contained all three requested items, their owners and the test marker `GENIE-UI-FIRST-43131`.
4. “保存…” opened the native save dialog. The saved Markdown file contained the generated text and original request.
5. The launcher stopped its app and services, then restarted using the same state directory. Home retained the completed task; opening it showed the same result and marker.
6. The managed test services were stopped. The normally launched app and its existing history were restored.

A separate live backend request with the same installed Ollama model completed in 11,297 ms. This is one local observation, not a general latency or quality guarantee.

## Findings and limits

- Temporal's container health probe needed its service address (`temporal:7233`), not container loopback. The launcher now uses the working address.
- A re-signed app copy encountered a Keychain access wait during preliminary testing. The successful native journey used the original signed app and a fresh preview identity. No existing Keychain items or security permissions were changed. macOS may still require the user to approve access to existing credentials.
- An already-running copy of the selected app is detected before dependency setup, with instructions to quit it and retry. The launcher does not terminate unrelated app instances.
- Normal app history, manual `.env` configuration and existing development containers are not migrated into the preview. Reopen preview work through the same launcher.
- Native recording, external-service OAuth, new-user download duration, Intel Mac behavior and broad local-model quality were not revalidated by this change. The deterministic CI fixture does not test macOS UI or Keychain behavior.

Usage: [日本語](../MANAGED_PREVIEW.ja.md) · [English](../MANAGED_PREVIEW.md).
