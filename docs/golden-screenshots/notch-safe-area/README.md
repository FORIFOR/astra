# Camera-safe Dock candidate — 2026-09-08

User-approved structure: attached substrate, content below NSScreen.safeAreaInsets.top.
Built-in Retina screen: 1728×1117pt, top inset 32pt. Captures use one pixel per point.
The hardware camera cutout is not present in window screenshots.

`task-dock/` contains 19 real state captures. Its `.geometry.json` files contain
window-server bounds and the declared content layout, **not AX element measurements**.
The AX geometry gate still reports SKIP because Astra's accessibility permission is
not confirmed. These candidates do not replace the historical RC goldens or claim
that the full release gate passed.

Before image source: development bundle SHA-256
`1a79c49345e10640ed6995b3af005e6d9d691ba59c1649ab971f54f2636b1b17`.
Same-machine before captures: `/tmp/astra-notch-before`.
Round and pixel comparison: `docs/ux-benchmark/compare/notch-safe-area/`.

Final development bundle executable SHA-256:
`f0457cb938b7d4da9ba79235d9a744b4a2678c47dcd296ccb0ad36f859c330b7`.
Light and dark each passed 16-surface capture and dimension checks. Historical
idle screenshots show shortcut badges; the current permission state shows
「クリック」. This difference is kept visible in the comparison report.
