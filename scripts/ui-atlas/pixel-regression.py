#!/usr/bin/env python3
"""既存面の pixel regression。

  python3 scripts/ui-atlas/pixel-regression.py <old-manifest.json> [new-manifest.json]

前の manifest（例: `git show <rev>:docs/ui-atlas/manifest.json`）と今の manifest を突き合わせ、
両方に在る面ごとに sha256 が同じか、違うなら画素の差（%）を出す。新規面は数えない（そちらは full audit）。
差が 0 でない既存面は、直す前に絵を見る（UIDiffImage / golden と同じ扱い）。
  PIXEL_REGRESSION=PASS ⇔ 既存面で差 > threshold（既定 0.5%）が 0
"""
import json, os, sys
from pathlib import Path
from PIL import Image, ImageChops

root = Path(__file__).resolve().parents[2]
atlas = root / "docs" / "ui-atlas"
old = json.load(open(sys.argv[1], encoding="utf-8"))
new = json.load(open(sys.argv[2] if len(sys.argv) > 2 else atlas / "manifest.json", encoding="utf-8"))
threshold = float(os.environ.get("ASTRA_PIXEL_THRESHOLD", "0.5"))
# 壁時計が写る面（挨拶 / 会議の題の時刻 / 『今日 · 42 分』）。差は時刻のせいなので、regression には数えず別に出す。
_td = json.load(open(atlas / "time-dependent.json", encoding="utf-8")) if (atlas / "time-dependent.json").exists() else {}
time_dep = set(_td.get("ids", []))
# 時刻ではないが run ごとに変わる面（理由つき）。regression には数えず「nondeterministic」として出す。
nondet = set((_td.get("nondeterministic") or {}).get("ids", {}).keys())
old_by = {s["id"]: s for s in old["screens"]}
rows, regressions = [], []
for s in new["screens"]:
    o = old_by.get(s["id"])
    if not o or not (o.get("image") or {}).get("sha256") or not (s.get("image") or {}).get("sha256"):
        continue
    for ap in ("light", "dark"):
        a, b = o["image"]["sha256"].get(ap), s["image"]["sha256"].get(ap)
        if not a or not b:
            continue
        if a == b:
            rows.append((s["id"], ap, 0.0, "same"))
            continue
        pa = atlas / s["image"][ap]
        # 前の絵は git にしか無いかもしれないので、寸法が同じなら画素で比べ、無ければ hash 違いだけ言う
        old_png = Path(os.environ.get("ASTRA_OLD_SCREENS", "")) / Path(s["image"][ap]).name if os.environ.get("ASTRA_OLD_SCREENS") else None
        if old_png and old_png.exists():
            im_a, im_b = Image.open(old_png).convert("RGBA"), Image.open(pa).convert("RGBA")
            if im_a.size != im_b.size:
                pct = 100.0
                detail = f"size {im_a.size}→{im_b.size}"
            else:
                diff = ImageChops.difference(im_a, im_b).convert("L")
                hist = diff.histogram()
                changed = sum(hist[8:])  # 8/255 以上の差がある画素
                pct = 100.0 * changed / (im_a.width * im_a.height)
                detail = f"{changed} px"
        else:
            pct, detail = -1.0, "hash differs (old png not available)"
        if s["id"] in time_dep:
            detail += "  [time-dependent fixture]"
        elif s["id"] in nondet:
            detail += "  [nondeterministic fixture: " + _td["nondeterministic"]["ids"][s["id"]] + "]"
        rows.append((s["id"], ap, pct, detail))
        if (pct < 0 or pct > threshold) and s["id"] not in time_dep and s["id"] not in nondet:
            regressions.append((s["id"], ap, pct, detail))
same = sum(1 for r in rows if r[3] == "same")
timed = sum(1 for r in rows if "time-dependent" in r[3])
nd = sum(1 for r in rows if "nondeterministic" in r[3])
print(f"PIXEL_REGRESSION existing faces compared: {len(rows)} (same {same}, time-dependent {timed}, nondeterministic {nd}, differ {len(rows)-same-timed-nd})")
for r in rows:
    if r[3] != "same":
        print(f"  {r[0]:36s} {r[1]:5s} {r[2]:6.2f}%  {r[3]}")
print("PIXEL_REGRESSION=" + ("PASS" if not regressions else f"FAIL {len(regressions)} face(s) over {threshold}%"))
sys.exit(0 if not regressions else 1)
