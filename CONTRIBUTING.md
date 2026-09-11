# Contributing to Astra

Start with a reproducible issue or a small workflow proposal. Please discuss larger changes before writing them, especially changes to permissions, external transmission, model routing, or the native interface.

Use synthetic data in examples, screenshots, and recordings. Do not include credentials, account exports, private meetings, or other people's messages. For a security issue, use GitHub's private vulnerability reporting if available; do not disclose an exploitable issue in a public ticket.

For UI work, read `AGENTS.md`, `shared/design/DESIGN.md`, `docs/DESIGN_SYSTEM.md`, and `shared/design/tokens.json`. Record the required reference/hypothesis/measured/candidates/gate round, regenerate affected goldens and geometry, and run `scripts/verify-all.sh` before committing. Do not hand-edit generated tokens.

For other changes, run the relevant tests and describe the actual validation and remaining limitations in the PR. Do not mark untested behavior as passed, remove a release gate to make it green, or introduce automatic paid retries.

The repository does not yet carry a project-wide open-source license. Please clarify intended contribution and reuse terms with the maintainer before submitting substantial code. Dependency licenses continue to apply.
