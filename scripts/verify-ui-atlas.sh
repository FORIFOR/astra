#!/usr/bin/env bash
# UI_ATLAS_GATE — docs/ui-atlas が「RC が描いた全 UI」であることを機械で確かめる。
#
#   required states with image       100%
#   required states with description 100%
#   image belongs to RC              100%   （.app の exe sha256 == manifest.rc.exe_sha256、画像の captured.exe_sha256 も同じ）
#   missing user-facing state        0      （capture が無い required 画面）
#   stale screenshots                0      （manifest に無い png / sha256 が合わない png）
#   unknown/manual mock              0      （source が RC 以外）
#   golden hash mismatch             0      （shots 10 面を committed golden と画素比較。debug 実行体が要る）
#   appearance policy honoured       0 違反 （fixed = Dock/HUD は light == dark、adaptive = Main/Workspace は light != dark）
#
# 1 つでも欠けたら UI_ATLAS_GATE=FAIL（exit 1）。.app や debug 実行体がこの機械に無い行は
# NOT_VERIFIABLE とし、PASS にはしない。
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
python3 - "$ROOT" <<'PY'
import hashlib, json, os, shutil, subprocess, sys, tempfile
from pathlib import Path
root = Path(sys.argv[1]); atlas = root / "docs" / "ui-atlas"
m = json.loads((atlas / "manifest.json").read_text(encoding="utf-8"))
rc = m["rc"]
rows = []  # (name, ok|None, detail)
def row(name, ok, detail=""): rows.append((name, ok, detail))
sha = lambda p: hashlib.sha256(p.read_bytes()).hexdigest()

req = [s for s in m["screens"] if s.get("required")]
missing = [s["id"] for s in req if s.get("status") != "CAPTURED"]
row("required states with image", not missing, f"{len(req)-len(missing)}/{len(req)}" + (f"  missing: {', '.join(missing)}" if missing else ""))

fields = ["trigger", "meaning", "primary", "keys", "privacy", "window", "invariant"]
nodesc = [s["id"] for s in req if any(not str(s.get(f) or "").strip() for f in fields)]
row("required states with description", not nodesc, f"{len(req)-len(nodesc)}/{len(req)}" + (f"  {nodesc}" if nodesc else ""))

# 画像の実体と sha256
bad_hash, referenced = [], set()
for s in m["screens"]:
    img = s.get("image") or {}
    for ap in ("light", "dark"):
        if img.get(ap):
            p = atlas / img[ap]; referenced.add(p.resolve())
            if not p.exists() or sha(p) != img["sha256"][ap]: bad_hash.append(f"{s['id']}.{ap}")
for st in m["strips"]:
    if st.get("image"):
        p = atlas / st["image"]; referenced.add(p.resolve())
        if not p.exists() or sha(p) != st.get("sha256"): bad_hash.append(st["id"])
on_disk = {p.resolve() for d in ("screens", "strips") for p in (atlas / d).glob("*.png")}
unknown_files = sorted(str(p.relative_to(atlas)) for p in on_disk - referenced)
row("stale screenshots", not bad_hash and not unknown_files, f"hash mismatch {bad_hash or 0}, unreferenced {unknown_files or 0}")

# RC 由来
mock = [s["id"] for s in m["screens"] + m["strips"] if s.get("image") and s.get("source") != "RC"]
row("unknown/manual mock", not mock, str(mock or 0))
not_rc = [s["id"] for s in m["screens"] + m["strips"] if s.get("image") and (s.get("captured") or {}).get("exe_sha256") != rc.get("exe_sha256")]
row("image captured from manifest RC exe", not not_rc, str(not_rc or 0))
app = root / rc["app"]; exe = app / "Contents" / "MacOS" / "AstraMac"
if exe.exists():
    same = sha(exe) == rc.get("exe_sha256")
    row("image belongs to RC (.app on disk)", same, f"{rc['app']} exe {sha(exe)[:16]}… vs manifest {str(rc.get('exe_sha256'))[:16]}…")
else:
    row("image belongs to RC (.app on disk)", None, f"{rc['app']} がこの機械に無い → NOT_VERIFIABLE")

# appearance_policy: 「同じなのは欠陥か」を毎回議論しない。manifest の意味を両方向で確かめる。
pol_bad = []
for s in m["screens"]:
    img = s.get("image") or {}
    if img.get("light") and img.get("dark"):
        same = img["sha256"]["light"] == img["sha256"]["dark"]
        pol = s.get("appearance_policy", "adaptive")
        if pol == "fixed" and not same: pol_bad.append(f"{s['id']} (fixed but light!=dark)")
        if pol == "adaptive" and same: pol_bad.append(f"{s['id']} (adaptive but light==dark)")
row("appearance policy honoured", not pol_bad, str(pol_bad or 0))

# strips
st_req = [s for s in m["strips"] if s.get("required")]
st_missing = [s["id"] for s in st_req if s.get("status") != "CAPTURED"]
row("required strips with 60fps frames", not st_missing, f"{len(st_req)-len(st_missing)}/{len(st_req)}" + (f"  missing: {st_missing}" if st_missing else ""))

# golden（shots 10 面）: atlas の png を golden の名前に戻して、画素比較の selftest にかける
bin_ = root / "apps/astra-macos/.build/debug/AstraMac"
if bin_.exists():
    for ap, gdir in (("light", "docs/golden-screenshots"), ("dark", "docs/golden-screenshots/dark")):
        with tempfile.TemporaryDirectory() as tmp:
            n = 0
            for s in m["screens"]:
                c = s.get("capture") or {}
                if c.get("selftest") == "shots" and (s.get("image") or {}).get(ap):
                    shutil.copyfile(atlas / s["image"][ap], Path(tmp) / c["file"]); n += 1
            r = subprocess.run([str(bin_), "--selftest", "golden", str(root / gdir), tmp], capture_output=True, text=True, timeout=300)
            line = next((l for l in (r.stdout + r.stderr).splitlines() if l.startswith("SELFTEST_")), "no SELFTEST line")
            row(f"golden hash mismatch ({ap})", line.startswith("SELFTEST_OK"), f"{n} faces → {line}")
else:
    row("golden hash mismatch", None, "debug 実行体が無い（swift build --package-path apps/astra-macos）→ NOT_VERIFIABLE")

for name, ok, detail in rows:
    mark = "PASS" if ok else ("NOT_VERIFIABLE" if ok is None else "FAIL")
    print(f"  {mark:<15} {name:<42} {detail}")
allok = all(ok is True for _, ok, _ in rows)
print(f"UI_ATLAS_GATE={'PASS' if allok else 'FAIL'}  (RC {rc['sha']}, required {len(req)}, NO_CAPTURE_PATH {len(missing)}, strips missing {len(st_missing)})")
sys.exit(0 if allok else 1)
PY
