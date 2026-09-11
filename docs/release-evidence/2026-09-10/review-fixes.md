# Release candidate review corrections — 2026-09-10

Release remains **NO_GO**. This record describes corrections after `23a9913`; it does not certify unmeasured live journeys.

## Corrected behavior

Initial-profile reads now use a dedicated, lease-bound metadata snapshot. They do not overwrite rich normal work artifacts, their semantic context, or synchronization cursors. Snapshot ingestion checks tenant, lease and provider, strips body excerpts and semantic data, and clears the snapshot on confirmation. Reclaiming an expired analysis resets its old progress and result groups. Database regression coverage exercises both normal-first and initial-first ingestion orders.

Profile field validation counts UTF-16 units consistently with the API, including emoji at the length boundary.

Browser meeting reminders identify calls by a hash of their provider-validated document URL. Joined-call controls and document identity come from the same AX web area. Multiple matching areas or incomplete enumeration produce an unknown observation. Delivery and recording actions recheck the call identity. Undelivered notifications can retry; explicit notification refusal and completed delivery consume the reminder for that call. An old failed delivery cannot invalidate a newer session.

An independent read-only review found no further concrete blocker in these corrections. This is source review, not a certification of live Zoom, Teams or Google Meet behavior. In particular, reusing the same meeting URL without observing a call exit remains unmeasured.

## Service evidence

- Google final authorized self-send and post-send meeting brief: **PASS**, with test-data cleanup. No further Google sends are authorized.
- Google initial-profile API/worker flow with the isolated snapshot: **PASS**, 58 artifacts (51 mail, 7 calendar), 4.191 seconds in this sample; confirmation and no repeated reads verified. Native onboarding was not measured.
- Microsoft read and send app registrations: completed as separate public clients. New OAuth data-access consent remains pending. The two previously authorized Microsoft self-sends have not been used.
- Targeted typecheck and generated schema: **PASS**. World-model: 106 passed; AgentHost: 147 passed. Gateway: 172 passed, one Redis test skipped in the targeted run. The subsequent workspace run supplies Redis and is reported separately.

## Accessibility observation

Full Keyboard Access and VoiceOver were temporarily enabled and then restored to their original OFF states. Keyboard focus was partly observed. During traversal, Space started a short recording; it was immediately stopped. This is not a completed keyboard journey. VoiceOver state retrieval timed out, so spoken output was not certified. Actual permission denial and recovery remain unmeasured.

Local detailed evidence is under `dist/release-validation/rc-0.1.2/` and the provider-specific validation directories. Credentials remain outside the repository.

## Current-source verification

The complete database-backed workspace run passed **2,220 tests with zero skips**, including Redis and Temporal. Migration apply, invariant checks and full rollback passed. Native unit tests passed **68 tests** and all three scripted journeys passed.

The first common verification run failed at `recordbutton`: its freshly packaged app used the packaging script's default Apple Development identity, while the already-authorized distribution uses Developer ID. The failure reported microphone permission unavailable. This run is retained as a failure; a new run explicitly uses the distribution's Developer ID identity. No TCC database or OS permission setting was changed to work around it.

For a release-validation run on this host, set `ASTRA_SIGN_IDENTITY` to the installed Developer ID Application identity before invoking `scripts/verify-all.sh`. The packaging script otherwise defaults to Apple Development. The second run's real five-second recording and transcription passed without changing OS permissions; gateway-dependent AI operations remain separately unmeasured when the gateway is absent.

The final Developer ID common verification completed with **VERIFY_ALL_OK**, 68 Swift tests, both golden comparisons, geometry and all three scripted journeys passing. This means the environment-supported common gates passed; the explicitly unmeasured live gates above remain open.
