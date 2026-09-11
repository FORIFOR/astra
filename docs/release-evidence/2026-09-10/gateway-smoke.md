# Gateway live smoke evidence — 2026-09-10

The local integration environment was started with Colima and `pnpm dev:infra` (Postgres on 5433, Redis on 6380, Temporal on 7233). The repository smoke path was then run with the Homebrew `libpq` client on PATH:

```text
PATH=/opt/homebrew/opt/libpq/bin:$PATH pnpm smoke
```

Result: `SMOKE PASSED`.

The run exercised the real gateway and worker startup path, `/healthz` and `/readyz`, tenant provisioning, the 14-plugin catalog, Temporal task completion (9 events), idempotency key reuse, artifact checksum verification, plugin dashboard installation, clarification/resolution, agent task creation, capability agreement, real meeting websocket recording (64,000 bytes), quiet-brief behavior, and tenant isolation (404).

This is an environment-backed gateway smoke gate. Provider OAuth live work-context runs remain a separate gate and require dedicated refresh-token test identities.
