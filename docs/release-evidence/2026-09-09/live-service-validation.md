# Live service validation, 2026-09-09

## Current checkpoint

Release is NO_GO. Shared progress and remaining gates: https://github.com/FORIFOR/astra/issues/1.

Google's fifth authorized self-send completed with exact receipt and all five daily answers passing, but the final meeting brief lost previous decision/action/mail facts. The complete normal gate is still FAIL. The earlier response-loss component passed with one accepted send and no retry. All five Google send authorizations are consumed.

Microsoft personal-account read authentication, refresh, identity and mailbox/calendar API access passed. The most recent seed code exchange returned Calendars.Read, Calendars.ReadWrite, Mail.Read, Mail.ReadWrite, Mail.Send and User.Read. Strict scope validation rejected the extra grants, and the seed credential was not activated. Two Microsoft self-sends are authorized and unused. Previous user consent is not evidence that the intended scope isolation passed.

This source checkpoint is shared for review and continuation. Historical notarization and verification results below do not attest this latest source or clear the outstanding release gates. Raw local logs and private authentication configuration are not included in this checkpoint.

Commit preparation: `scripts/verify-all.sh` completed with `VERIFY_ALL_OK` on retry; the first attempt failed a dark meeting-detail golden comparison where the captured window was clipped at the display edge. No reference image or product code was changed to turn that failure into a pass. The retry passed both golden comparisons, all three journeys, and 50 Swift tests. Online gateway-dependent checks were skipped as reported by the harness. TypeScript typecheck and OAuth/connector/Agent Host tests also passed. This environment-scoped result does not clear the live-service, accessibility outcome, review, latency or final artifact gates above.

## Validation history

### Remaining-task corrections

- Microsoft connector credentials now bind to dedicated read/send client IDs. Cached legacy or cross-client tokens fail before Graph access; refresh responses with scopes outside the connection are rejected before storage or use. The live harness also requires separate seed/read/send app registrations and rejects broadened send grants. New Azure read/send registrations are prepared, but their final policy acceptance and subsequent account consent remain pending; no Microsoft send has been consumed.
- Full database-backed workspace tests completed: 2,189 passed and one rate-limit test skipped. `verify-all.sh` completed with `VERIFY_ALL_OK`, 53 Swift tests, both golden comparisons, and JA/JB/JC. Recording checks still selected the historical 0.1.1 bundle; final 0.1.2 verification must select the rebuilt artifact explicitly. Generated journey results were retained in ignored local evidence.
- OAuth tests: 48 passed; Agent Host tests: 141 passed; macOS unit tests: 53 passed. TypeScript typecheck passed. These results cover the separation implementation, not live Microsoft authorization.
- The distribution candidate version is now 0.1.2; GitHub already publishes 0.1.1. Root, Tauri and core versions and their Cargo lock entries agree. No existing release asset is replaced.
- GitHub CI exposed stale `infra/db/schema.sql`. Regenerated from all migrations in a disposable database; schema, generated database types, Dock geometry, CRM entity and shortcut checks now pass locally. The contract package version was advanced to 0.44.0 for the previously added contract changes. The next CI run isolated a further pg_dump 18 vs 16 difference: the restore-session `transaction_timeout = 0` line. The generator now normalizes that line; wrapper tests compare 16/18 output, retain real schema changes, and preserve prior output on dump failure. Generated checks pass locally. CI must confirm the corrected checkpoint.

- Reproduced a missing-history case: an unclassified reply and calendar event formed a title-only cluster, which displaced the uniquely named explicit project when building the next brief. Explicit project matching now precedes the cluster-size shortcut. Multiple matching project names do not choose an arbitrary history, including when no reply exists. The regression checks prior decisions, actions, subsequent mail and exclusion of other projects. Targeted work/brief tests: 40 passed.
- Microsoft refresh requests now explicitly request the configured scopes instead of relying on the provider's default grant. OAuth tests: 38 passed. Live credentials still require strict returned-scope and identity verification; this source change does not establish live separation by itself.
- Microsoft validation applies its nonce to mail searches and filters returned mail/calendar titles before classification and cloud publication. Agent Host tests: 132 passed. Calendar filtering occurs locally after the bounded provider listing.
- Google no-send diagnostic WC47197 passed all daily-answer and next-brief assertions; cleanup succeeded. It creates no send task and does not load a write grant. This does not replace final post-send validation; the five Google send authorizations remain consumed. Microsoft sends remain unused.
- Corrected an invocation measurement error: microphone arrival was checked only after the window animation settled, including its 120ms stability wait. It is now sampled concurrently with the animation. A signed local candidate measured first audio at 187.7ms (target below 200ms), visible feedback at 50.3ms, and stop feedback at 58.3ms. This is a measurement correction, not a change to microphone capture. The same invocation run failed focus preservation because macOS UserNotificationCenter became frontmost; the overall invocation gate is not PASS. This diagnostic candidate is not the final notarized distribution.

TypeScript typecheck and nine gateway/DB work integration tests passed after these corrections. `verify-all.sh` completed with `VERIFY_ALL_OK`, including 50 Swift tests, JA/JB/JC, and both golden comparisons. Its recording section automatically selected the existing distribution (and therefore printed the old microphone measurement); this mixed-candidate run is not final artifact attestation. The rebuilt distribution must be selected explicitly for final validation. Full Keyboard Access/VoiceOver outcome journeys, OS permission recovery, complete product review, live post-send gates, and final distribution verification remain outstanding.

Release remains NO_GO until all gates are verified. Earlier notarized binaries do not attest the source changes below.

Google OAuth was configured in the Astra project, with a Desktop client and one explicitly selected test account. Read, write, and seed grants were acquired separately, identity checked, and refreshed through Astra. Read grants retained only read/identity scopes after the other grants were added. Gmail profile and Calendar list calls returned HTTP 200. Credentials remain outside the repository in the private release-validation environment file (0600); no token values belong in evidence.

Real-service testing exposed and corrected:

- Google Desktop refresh requests omitted the configured client credential. Provider configuration now passes the Google value at runtime; PKCE remains required for authorization.
- A populated test account required a provider search restriction before synchronization and classification. The harness restricts Google queries to the current fixture nonce.
- The seed utility inserted raw UTF-8 Subject headers, which Gmail returned as mojibake. It now uses the product MIME builder, preserves its Date header, and generates an RFC Message-ID.
- Self-delivered Gmail messages appeared in INBOX and SENT with one ID. Synchronization now keeps the incoming representation instead of overwriting it with an outgoing one.
- Reply steps confused Gmail message IDs with RFC Message-ID headers. The connector resolves the original message and supplies In-Reply-To, References, and the original thread ID; mismatched expected threads fail before send.
- Task plans now preserve the requested Gmail thread. Receipt comparison converts the internal namespaced thread ID to the provider ID before exact matching.
- Date-only classifier output previously invalidated the entire classification. Its unqualified timestamp is now left unset while valid classification/project fields remain; no time or timezone is fabricated.
- The next-meeting fixture previously fell outside the product's 24-hour window for morning executions. It is now one hour ahead. The waiting fixture explicitly states what response is awaited.

Evidence is under dist/release-validation: google-oauth, google-live-authorized, google-live-scoped, google-live-diagnostic, google-live-mime, google-live-thread-fix, and google-live-recovery. Failed runs are retained as failures. Test databases and provider fixtures are cleaned after each run. Gmail test messages are trashed, not permanently deleted.

Microsoft: an Astra Desktop app registration was created in the user-selected tenant. The user selected the signed-in organizational account for validation. Its separate OAuth MFA challenge is awaiting completion; app registration alone is not evidence of Outlook access.

At this checkpoint the full end-to-end Google result and Microsoft grants remain subject to their live result files. Full Keyboard Access/VoiceOver outcome journeys, OS permission deny/recovery, whole-product review, microphone latency, and final release rebuild/verification are still required.

## Latest response-loss attempt

All three authorized Google self-sends have been consumed. The third run (WC32383) did not inject response loss because its marker search decoded the Gmail envelope but not the MIME base64 body. This run is not a recovery PASS. The missing fault log also prevented the harness from printing the remaining result rows. Both harness defects are corrected: MIME body decoding uses the actual product encoding in its regression test, and missing evidence produces a failed recovery row instead of aborting reporting.

A read-only provider metadata check confirms the third reply has the original thread ID, RFC In-Reply-To and References. All three messages for this fixture have the TRASH label. This proves those properties only, not the entire live gate. Evidence: `dist/release-validation/google-live-recovery/provider-metadata.json`.

Agent-host tests: 131 passed; full TypeScript typecheck passed after the harness correction. An additional single self-send authorization has been requested for the corrected recovery validation. Microsoft remains at its separate biometric/PIN/security-key challenge. No release GO has been declared.

## Corrected response-loss run and answer diagnosis

The user authorized a fourth single Google self-send. WC32866 then proved accepted-send response loss: attempts=1, accepted=1, failed/ambiguous task stopped, exact receipt matched, and no retry. All Reply and Recovery rows passed. Home, personalization, and next brief rows passed. The overall live gate still failed three daily answer rows, so it remains FAIL, not a full provider PASS. Cleanup completed. Evidence: `google-live-recovery-fixed/result-google.txt` and its fault JSON.

A subsequent no-send diagnostic retained question/context/answer evidence. Priority injection omitted the concrete obligation and exposed only relative deadline/status lines. Meeting preparation received a calendar status line instead of the already available prior meeting facts. A stale fixture subject also contradicted the real event start. Corrections preserve the concrete obligation and exact deadline, use the sourced brief for meeting preparation, and remove the stale subject time. The diagnostic branch exits before send-task creation and write-grant loading and reports READ_DIAGNOSTIC rather than a full live gate. World-context regression tests: 27 passed; typecheck passed. Live read-only revalidation is in progress.

The corrected no-send diagnostic WC33276 completed with GOOGLE_READ_DIAGNOSTIC=PASS, including all five daily answers and next brief. Fixture cleanup succeeded. Latest host tests remain 131/131; credential-boundary check passed. This is not substituted for a full normal-send gate. All four explicitly authorized self-sends have been consumed. Microsoft MFA and the other previously recorded release conditions remain outstanding.

Microsoft read consent completed. Astra refresh and identity verification passed with only read/identity scopes. Graph /me returned 200, mail was unset and assignedPlans contained no Exchange service. Both messages and calendars returned 401 with empty bodies; Outlook web also failed with StartupData ServerError 500. This is a mailbox availability blocker, not missing user consent. Existing licensing is being checked; no write grant, test send, or purchase has been performed.

Microsoft 365 admin center Products showed 0 subscriptions and a disabled Assign licenses control. No existing license was available to assign from that view. Further Outlook verification requires a mailbox-enabled identity or a user-authorized licensing decision. No subscription was purchased.

The user selected a personal Outlook.jp test identity. The authority was switched to consumers; prior organization refresh tokens were isolated outside the repository and removed from the active test environment to avoid cross-account use. At that checkpoint, personal account read authorization was awaiting the displayed passkey/biometric sign-in.

Personal Outlook.jp read authorization completed with identity verification. Astra refresh attested Mail.Read, Calendars.Read, User.Read only. Graph identity, messages (ID-only), and calendars (ID-only) all returned HTTP 200. Separate seed and write consent pages are prepared for the user; neither has been accepted by the agent. Explicit maximum-two Microsoft self-send and final-one Google self-send authorizations were requested. Full release remains NO_GO pending those and the other recorded gates.

User authorized 2 Microsoft self-sends and 1 final Google self-send. Google WC34358 consumed the fifth authorized send: send completion, exact receipt and all five daily answers PASS; final brief lost previous decision/action/mail facts, so overall normal gate remains FAIL. Cleanup completed. No Microsoft sends consumed. Microsoft seed/write code exchanges failed strict scope verification; token requests are being corrected to explicitly include intended scopes and persist safe scope diagnostics. Seed retry is awaiting user consent; failed grants were not saved.

The next seed consent returned server_error from Microsoft. The earlier utility incorrectly labeled every callback without a code authorization_denied; it now preserves the provider error separately. A silent recovery attempt returned interaction_required. A fresh single consent page is prepared. This is not a user refusal, and no Microsoft test messages have been sent.
