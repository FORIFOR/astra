# Session renewal and local writing — 2026-09-11

This round closes the normal session-expiry failure and adds bounded recovery behavior. It does **not** establish product-wide `release=go`. Local video drafts still fail factual/quality review. The same brief succeeded through the explicitly authorized Codex CLI. Native accessibility must be rechecked on the final distributed app.

## Session behavior

- Desktop and execution host own separate refresh chains. Refresh credentials are stored in their OS credential store; access tokens stay in memory. Bootstrap credentials are removed from the host environment before launching model/tool children.
- Concurrent callers within a process share one refresh. The desktop renews early and on activation, preserving the open conversation and initial-profile result.
- A write-ahead marker is persisted before refresh. A lost response, interrupted process or failed persistence cannot cause the old refresh token to be replayed. A known 429 rejection backs off; uncertain rotation requires a fresh sign-in.
- Real testing exposed two leftover host processes sharing a credential file. The startup now acquires an OS-owned loopback socket lock before accessing credentials. Duplicate processes fail before reading/writing them. An unrelated collision on the derived local port also fails startup explicitly; it never silently selects another lock. The OS releases the socket on a crash. Desktop processes use a kernel file lock across credential read, rotation and persistence.
- Only the gateway's explicit pre-handler authentication errors permit one request retry. Network failures, 5xx responses and unrelated 401 responses do not replay a mutation. Poll failures back off instead of repeating every two seconds.

`native-session.log` exercises the real local gateway, eight concurrent native callers and Keychain reload, keeping the same user/tenant. `host-session.json` exercises 12 concurrent calls, two real rotations and restart with the same host ID. These use an advanced client clock to reach the expiry boundary; they are not a claim of waiting 15 wall-clock minutes. `host-instance.json` confirms a real second host exits before changing credentials. Unit tests cover crash markers, failed saves, 429, lost responses and process-lock recovery.

## Writing behavior and cost

- Explicitly negated sending requests and writing requests such as an account-registration notice remain composition. Actual send commands retain the action path.
- Composed artifacts contain only the requested text. Draft/sent state is metadata, instead of an unrelated mail-sending footer appended to every document.
- Prose uses plain text; structured operations retain JSON. The configured local model must actually be installed. Empty results, output truncation and timeout are distinct failures with useful recovery messages.
- API/CLI generation is still single-attempt with no automatic paid fallback or model critic. A local draft with a detected concrete violation may receive at most **one** local revision. A remaining detected violation is an error, not a completed artifact. These inexpensive checks are deliberately limited; passing them does not certify factual or creative quality.
- A brief that explicitly prohibits unverified numerical claims is checked for unsupported percentages and multipliers. Matching is exact and normalizes full-width numbers, so a supplied `15%` does not justify a fabricated `5%`. The same checks now reject invalid paid-provider compositions without another generation or fallback. They do not establish causal correctness or catch every unsupported claim.
- Default output budget remains 4,096 tokens and the HTTP deadline 120 seconds. Larger budgets/thinking configurations were tested and rejected for this PC's normal workflow. Periodic classification remains local-only unless metered use is explicitly enabled.

## Actual model evaluation

`evaluate.mts` calls Astra's real `LlmRuntime` and local HTTP adapter with five synthetic briefs: short announcement, three video concepts, website proposal, grounded responsibility answer, and a question lacking evidence. `models/` contains unedited outputs, including failures. `ok: true` means the runtime returned text; it is **not** a quality verdict.

The selected local runtime remains qwen3.5:9b with thinking disabled for responsiveness. Short factual answers and a basic announcement worked, but its video draft invented phone operation and UI behavior and repeated similar story structures. The deterministic checks did not catch every error. Gemma 3's website/grounded answers were usable drafts, but its video request was rejected after the bounded revision. Larger Qwen models did not justify their latency or memory use. A thinking run with a larger budget was stopped after more than three minutes; overlapping it with the UI test delayed the latter. The uncontended short AI action then passed. A later native three-video request exposed an independent production defect: the task activity timed out after 30 seconds while the model was still generating. That failure and its fix are recorded below. The local-model comparison made no paid-model calls, and discarded comparison models were removed; the user's original llama3.2 and qwen2.5 models were retained.

**Local creative-generation gate: FAIL / review required.** No viral video, published post, deployed website, trading strategy or independent blind review is claimed here. Replacing a model is not by itself a solution to reliable autonomous deliverables.

A final bounded comparison used local `gpt-oss:20b`, low reasoning, the same 4,096-token / 120-second limits and five synthetic cases. It was fast, but an initial website proposal invented percentage and multiplier targets, and its video concepts repeated a procedure or invented mobile operation. After the metric instructions/checks, its website draft supplied comparison methods without invented numbers (5.372 seconds); grounded and unknown answers also worked. Its video still falsely claimed smartphone-only use (13.350 seconds). The platform check was then extended against this captured real output and bold option headings; `observed-draft-check.json` confirms that specific invalid result is now rejected. This replay is not another successful live generation. The model was **not adopted**, and its downloaded weights were removed. Raw before/after outputs are retained in `models/gpt-oss-20b*`; runtime `ok: true` in those historical files must not be read as a manual quality pass. Local semantic/creative quality remains unresolved.

The identical three-video brief was then run through Astra's existing Codex CLI boundary (`models/codex-cli/video.json`, 39.3 seconds, one generation). It returned three distinct structures with timed shots, spoken copy and a final line, using only the supplied Home/Work/copy/Markdown capabilities. Manual review found no invented mobile platform or unmeasured speed/price claim. This is one successful scenario, not a blind assessment or a claim of viral success. The normal writing host can use this authorized Codex route; local-only selection remains explicit and cannot spend a configured API or CLI provider. Quota failure is reported without silently changing the selected route.

## Native long-running request and concurrent task isolation

An actual Home request failed after 30 seconds even though its Codex generation continued. The Temporal activity declared a 30-second heartbeat timeout but never sent heartbeats while awaiting the host. `executeStep` now reports progress every ten seconds, clears its timer on success/failure, and retains the five-minute overall deadline and single-attempt policy. It does not retry a charged generation.

The same inspection found a shared mutable model/task context across concurrent activity executions. Research and meeting model calls now use `AsyncLocalStorage.run` scoped to each activity; an overlapping three-user test verifies that host calls retain their own user, tenant and task IDs.

After restarting the real worker, the native Home → leave to Home while processing → reopen in Work → copy → Save panel → Markdown journey passed. `native-workflow.json` records one model call taking **44.457 seconds**, beyond the old timeout. The saved document contains the exact returned body plus the intended title/request appendix. `native-video-draft.md` is that unedited export. The three concepts respect the supplied Mac workflow and distinguish their presentation. No posting, sending or video rendering was performed. The earlier failed task remains in history; the test explicitly reused its request instead of silently retrying it.

A host was also left running past actual access-token expiration. `host-natural-renewal.json` confirms the persisted refresh chain rotated after more than 22 wall-clock minutes without restarting that process. It records no credential material.

## Test isolation preserves the user's live-transcription choice

Normal launch exposed Google live transcription being OFF. The old egress test saved `object(forKey:)`, including the launch argument `NO`, and wrote that value into the persistent domain during restoration. A separately signed, isolated test bundle reproduced this exact regression: a persisted `true` became the string `NO`, which disabled consent (`consent-before.json`). The user's real preference was not modified by that reproduction.

All self-tests now start with a process-only local-transcription override. Dedicated cloud tests enable it only after checking their explicit fixture opt-in. Test changes and restoration use the volatile argument domain; none of the cloud-consent tests writes the user's persistent choice, even if cleanup does not run. Normal Settings changes remain persistent. `consent-isolation.json` verifies both initially ON and initially OFF settings across actual app processes with a `NO` launch override. The privacy gate and all 109 Swift tests passed. The user's previously authorized Google live-transcription setting was restored to ON through the actual Settings UI.

## Validation

- TypeScript type checking; 182 host tests; 109 Swift tests; 18 task heartbeat/metering tests; 102 research tests passed. The latter include overlapping task isolation.
- Real gateway renewal and duplicate-host startup checks passed.
- Synthetic recording recovery now opts in within the test process, preserving the user's persistent audio preference. Recovery cleanup no longer removes unrelated candidates.
- Session/DB synchronization tests no longer require microphone access; dedicated microphone tests remain separate. Home-focus tests open the real local store and activate the test app before testing passive refresh.
- A later extracted-artifact run also exposed unstable launch-time focus in the test setup (45 PASS / 4 SKIP / 2 FAIL). The fixture now waits for the actual Home key window to be active and stable before beginning; it fails setup explicitly if that never happens. Notes/Ask, passive updates and sharing assertions remain unchanged. Three separate signed diagnostic-app launches passed with window-state traces (`focus-setup-*.log`). Final artifact revalidation is recorded in the ignored distribution receipt.
- `verify-all.log`: **VERIFY_ALL_FAIL**. The remaining failure is real E2E-001 accessibility insertion (`inserted=false`). Real microphone recording and local save passed before that step. Three native journeys and 109 Swift tests passed. Permission-dependent SKIPs are not interpreted as successful real interactions. Distribution receipts are written separately under ignored `dist/release-validation` after packaging.

The development gateway, Temporal worker, local host and Ollama remain prerequisites on this PC. A signed/notarized DMG does not prove those services are deployed for other users. No additional test mail, external message or social post was sent in this round.
