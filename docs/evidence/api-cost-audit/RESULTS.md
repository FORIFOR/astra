# API cost audit — 2026-09-11

Scope: native recording/live transcription, native translation, meeting AI actions,
server translation/finalization, Temporal retry policy, and the local agent host's
HTTP models and background mailbox classification. This audits implementation and
request counts, not invoices or historical billing.

## Fixed

| Path | Previous behavior | Revised behavior / regression evidence |
| --- | --- | --- |
| Native meeting AI | Repeated clicks could submit concurrently; empty/interim speech was sent; each action appended a whole transcript to a shared conversation | One in-flight action; confirmed nonempty speech only; reuse the answer for an unchanged meeting/action/source snapshot; each new action has its own conversation |
| Queued AI result | A 30-second result timeout led the next attempt to submit a new task | Retain the accepted task ID and poll it; two result checks submit only one job. Known failed/cancelled jobs allow a subsequent explicit retry |
| Native long translation | A failure in chunk 2 discarded the successful first chunk | Bounded memory cache (128 chunks), keyed by endpoint/model/credential/target language/source. A three-chunk request failing at chunk 2 needs four calls including retry, instead of five |
| Translation controls | Cancelling then quickly toggling language/automatic update could discard a paid result and submit it again | Finish/cache the single already-submitted request; no next utterance while disabled. Language A → B → A requires two calls, not three. Repeated selection does not auto-retry failures; reset still rejects old-session results |
| Server translation | Database uniqueness prevented duplicate rows but did not prevent duplicate provider calls | Lock the persisted source, read existing translation before calling, and save translation + event atomically. Concurrent service instances and later retries call the provider once. Same-language and other-tenant cases make no extra calls |
| Meeting finalization | `meeting.summarize` generated once, then `meeting.bundle` generated the same summary again | Carry the durable Temporal activity result into bundle rendering, including an empty result. Worker restart/repeated rendering uses that result. Old histories/direct calls without a previous result retain their fallback |
| Generative workflow retry | READ-classified model/research steps inherited up to five activity attempts, plus fallback paths | A versioned workflow policy uses one attempt for built-in model, model-backed research, and meeting generation; activity errors do not escalate into another paid route. Host-offline waiting and ordinary connector-read retries remain |
| Live STT connection | WebSocket upgrade opened Google even if the audio source delivered no frames | Google opens only on the first nonempty audio frame. Finish/close without audio opens zero provider streams |
| Live STT failure/end | Authentication/configuration/quota errors reopened streams; an unresponsive stream could survive half-close | Only bounded transport reconnects; no replay of accepted frames. Destroy replaced/finished streams, ignore late callbacks, forbid post-finish audio, and make finish idempotent |
| HTTP LLM output | No explicit output token ceiling | Default 4,096 output tokens; configurable integer 1–16,384 via `ASTRA_LLM_MAX_OUTPUT_TOKENS`. Empty prompts are rejected; truncated output fails visibly without automatic regeneration |
| Background mail classification | Periodic sync could use an available paid API/CLI model without a new user action | Default periodic inference is local only. `ASTRA_WORK_SYNC_METERED_LLM=on` explicitly allows metered models. User-requested AI actions still use the configured selection. Connector sync and the one-time initial profile remain available without a model |
| Local inference boundary | A remote address could be labeled local | The HTTP local-model adapter requires a loopback endpoint; no silent remote fallback |

No model was downgraded and no audible speech was discarded to reduce requests.
The microphone and system-audio streams remain separate for speaker attribution.
The native live-only path still does not automatically run a second batch
transcription after stopping. Translation is opt-in and uses confirmed utterances;
same-language native translation bypasses the model. Incremental meeting notes and
the initial profile use existing local/deterministic processing.

## Verification

- Swift: 93 regression tests (translation HTTP/coordinator and meeting-AI request
  counters included), all passed.
- Node/TypeScript: 345 tests in 35 files, all passed. This includes a disposable
  PostgreSQL database, cross-tenant isolation, concurrent translation across
  service objects, and the existing Temporal task end-to-end tests.
- TypeScript production/test type checking passed.
- Tests inject HTTP/LLM/STT providers. No additional audio or text was sent to a
  paid recognition/translation/model service during this audit.
- No visual geometry/token/style changes were made. The previous full product
  gate remains on hold (effective accessibility and agent execution setup).
  These scoped cost checks do not establish `release=go`; no commit/push is claimed.

## Remaining cost boundaries

Google STT remains a paid service when enabled. Its official pricing is based on
processed audio; other Google resources such as storage can be billed separately:
[Google Speech-to-Text pricing](https://cloud.google.com/speech-to-text/pricing).
This change prevents redundant work; it is not a monetary spending cap or a claim
that recognition is free. Actual savings depend on usage and provider billing.

A submitted request may already have been processed if its response is lost. The
app cannot reverse that charge. The translation pause finishes the current bounded
request but does not submit the next utterance. Manual retries of an ambiguous
failure, process termination before result persistence, old workflow histories,
and third-party plugin tools with undeclared billing remain outside an exactly-once
guarantee. Native result caches are bounded, in memory, and scoped to their source
and model/account; they do not survive app restart.

Protocol reference: direct OpenAI Chat Completions uses
`max_completion_tokens` (including reasoning), while other compatible servers
retain `max_tokens`. No fallback request is sent just to negotiate a limit.
[OpenAI Docs — Create chat completion](https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create)
