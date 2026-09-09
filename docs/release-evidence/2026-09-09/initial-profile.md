# Initial profile implementation — 2026-09-09

Scope: the first Google / Microsoft read connection starts one bounded initial profile. macOS shows progress and five editable groups in Home. Confirmation freezes those groups for personalization; reconnecting and restarting do not schedule a new profile. No new continuous-learning or Memory interface.

Validation completed:

- Database-backed workspace suite: 2,211 passed, one environment-dependent rate-limit test skipped.
- Final world-model suite after long-subject handling: 104 passed, including five initial-profile cases. Covers actual partial data, tenant separation, exclusive/expired leases, edits, confirmation persistence and retry.
- AgentHost suite: 146 passed. Initial reads are provider-scoped, metadata-only, with 45-day mail / 90-day past and 45-day future calendar bounds.
- API gateway suite: 172 passed, one skipped. Includes begin / claim / progress / finish / confirm and invalid-state/size handling.
- TypeScript typecheck passed.
- SwiftUI initial-profile captures: analysis / ready / editing in both themes. Real edit-button handler exercised. Images and geometry are in `docs/golden-screenshots/initial-profile/` and contain fixture data only.

The common native verification now defaults to its freshly built signed application for recording checks, instead of implicitly selecting an older `dist/Astra.app`. It also includes the initial-profile UI selftest. The final common run passed (`VERIFY_ALL_OK`), including 64 Swift tests, both golden comparisons, geometry, three journeys, recording recovery and the six initial-profile captures. Live-service-dependent checks remain explicitly skipped.

Limits: actual Google / Microsoft initial-profile reads and native end-to-end onboarding remain unverified. The 15–30 second target has not been measured against live services. Running the flow needs the migrated gateway and AgentHost authenticated as the same user; this change does not create a new production registration/authentication system. Earlier signed-artifact results do not certify these changes. Release remains NO_GO until the outstanding live-service, accessibility, permission-recovery and independent-product-review checks are complete.

A prior common run detected a clipped Dock result corner in one screenshot (alpha 204). An isolated repeat of all 19 Dock states passed without a source change; the failure is retained in local diagnostics and must not be described as a fixed product defect. The final complete common suite subsequently passed without relaxing a threshold. A separate guide-image capture failure was resolved by capturing all 16 current-app screens in a fresh data directory and using the existing `ASTRA_GUIDE_CLEAN_SHOTS` option; no older images were substituted.

## Live follow-up (2026-09-09)

A read-only Google probe using the existing authorized read grant found two real failures that the fixture-only checks missed:

1. AgentHost sent an empty POST with `Content-Type: application/json` when claiming the initial job. Fastify rejected it with HTTP 400. The shared cloud transport now adds the JSON content type only when a body exists. A real HTTP regression test covers bodyless claims and 204 responses.
2. A real contact generated a personalization trait key longer than the contract's 100-character limit, causing progress persistence to return 400. Long keys now use a stable SHA-256 identity instead of truncation; existing short keys keep their identities. Labels are bounded without splitting Unicode characters. A regression verifies distinct long contacts remain distinct.

After both fixes, `scripts/reality/run-initial-profile-live.sh` passed against a freshly migrated, disposable local gateway/database: 51 mail artifacts, 7 calendar artifacts, 54 provider GET requests, 2,307 ms from begin to ready. Confirmation persisted, reopening retained the same profile, a repeated job performed zero provider reads, and Home's work-context API returned successfully. No mail was sent or seeded, and no external data was modified. Tokens stayed in process memory and the temporary database was removed. Evidence contains counts only, not messages, addresses, titles or profile content.

This is **API/worker live evidence**, not a native screen walkthrough. Microsoft, native onboarding, accessibility/OS recovery and independent review remain open. The successful duration is one Google run, not a latency guarantee. Focused checks: world-model 105 passed; AgentHost 147 passed; typecheck passed.
