# @astra/desktop

Tauri v2 + React desktop client. Owns the Local Control Plane
(product spec §16.1) and the 4-tab shell (§2).

## Phase 0 status

Web layer only. The Rust side is **not** initialized yet.

Phase 1 initializes it with:

```sh
pnpm --filter @astra/desktop exec tauri init \
  --app-name Astra \
  --window-title Astra \
  --frontend-dist ../dist \
  --dev-url http://localhost:1420 \
  --before-dev-command "pnpm dev" \
  --before-build-command "pnpm build"
```

Bundle identifier: `com.astra.desktop`.

Reuse candidates from `../../../deepnote-desktop/src-tauri/src/` — see
`docs/spec/phase-0-implementation-spec.md` §12.
