# Connections completion — 2026-09-13

reference : Google native OAuth https://developers.google.com/identity/protocols/oauth2/native-app and Microsoft authorization code flow https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-auth-code-flow (2026-09-13); service identity and requested access must match the actual authorization.
hypothesis: Replace four disconnected service buttons with two account connections, a purpose preview, cancellation/recovery, and verified connection details. Normal app launch must load publisher configuration without shell variables.
measured  : Existing native capture connections-1162-light.png has two provider cards, four service-level connect buttons, all disabled with “準備中”; current implementation reads client IDs only from ProcessInfo.environment, has no cancel/timeout control, and omits Google's desktop client_secret during token exchange.
candidates: A = four per-service connect buttons / B = two provider connect actions, exact included services, one purpose sheet, status and recovery per provider / C = a marketplace of unimplemented services. Choose B; C cannot complete a real connection.
gate      : OAuth HTTP tests, scope/partial-consent and persistence tests, cancellation/stale-callback tests; native light/dark captures at 940 and 1162pt with geometry; verify-all.sh before commit. No changes to radius, type, spacing, shadow or token values.

## Acceptance

- A normal Finder launch can use configured Google/Microsoft native clients.
- One provider connection authorizes the selected read services; send grants remain separate.
- Missing configuration, backend failure, rejected/partial consent, timeout and cancellation have actionable states.
- Only a local credential plus a matching server connection is shown as connected.
- Disconnect includes the provider's send credentials; failures cannot be presented as success.
- Connection success links to Profile and a first task; unsupported services are not advertised as implemented.

## Observed result

Two provider actions replace four disconnected service actions. Repeated headings and idle-only recovery controls were removed; the 940pt capture now shows both services and the advanced disclosure without scrolling. Actual geometry is 940×672 and 1162×768. OAuth purpose and busy/cancel states were exercised in the running signed app. Google authentication and restart persistence passed; Microsoft remains at user passkey authentication. See `docs/evidence/connections-completion/RESULTS.md` for validation and external limits.

## Recovery refinement

reference : Existing Initial Profile and Home surfaces; retain the same window and Connections entry point.
hypothesis: A failed first read must clearly stop claiming to build, explain the Keychain recovery step, and allow Home use while authorization is deferred.
measured  : Live Google profile reached `failed` after the Keychain wait, but still displayed “Building your Astra Profile” with only Retry and no exit to normal Home.
candidates: A = retry-only failed screen / B = failed heading, recovery guidance, retry and “あとでHomeへ”; explicitly reopen from Connections. Choose B.
gate      : Failed-profile native light/dark captures and geometry; hide/reopen state regression; full verify-all. No token or ornamental changes.
