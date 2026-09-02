# Astra — repo rules for coding agents

UI（`apps/astra-macos`、`apps/windows`、`shared/design`）を触る前に、必ず読む:

1. `shared/design/DESIGN.md` — 何を目指すか、どの面にどの製品の作法を借りるか、
   借りたものをどう検証するか（BEST-IN-CLASS_REFERENCE_GATE）。
2. `docs/DESIGN_SYSTEM.md` — 確かめ終わった規則（DS-01〜05、占有 §7）と、試して捨てたもの。
3. `shared/design/tokens.json` — 寸法・色・段の正本。`pnpm -s gen:design-tokens` で
   `GeneratedMetrics.swift` / `GeneratedMetrics.cs` に写す。手で写さない。

造形を変える round は、DESIGN.md §4 の 5 行（reference / hypothesis / measured /
candidates / gate）を先に書く。参照が言っているだけでは値を変えない。
採用したら golden（`docs/golden-screenshots`）と `geometry` を撮り直し、
`./scripts/verify-all.sh` が緑になってから commit する。
