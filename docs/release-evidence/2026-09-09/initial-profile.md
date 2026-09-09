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
