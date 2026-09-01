#!/usr/bin/env python3
"""Trust の A/B/C を比べ、採否を決める。

採否の規則（LOOP.md）:
  狙った軸（trust）       >= +0.25
  壊してはいけないもの     > -0.15（clarity / calmness / hierarchy / density）
  1 つでも該当したら不採用

**画面に無い文字を根拠にした採点は捨てる**（OCR 照合）。
"""
import glob, json, os, re, statistics, sys, unicodedata

ROOT = sys.argv[1] if len(sys.argv) > 1 else "artifacts/ux/trust"
# 狙う軸は周ごとに変わる。Judge が出した key をそのまま使う。
TRUST = os.environ.get("UX_TARGET_AXES", "provenance_comprehension,source_discoverability,"
                       "correction_discoverability,verification_cost,confidence_to_share").split(",")
GUARD = ["clarity", "calmness", "hierarchy", "density"]

def norm(s):
    return re.sub(r"[\s　:：・…\.\-‐―「」\"']+", "", unicodedata.normalize("NFKC", s).lower())

def load(variant):
    d = os.path.join(ROOT, variant)
    ocr = ""
    p = os.path.join(d, "ocr.txt")
    if os.path.exists(p):
        for line in open(p, encoding="utf-8"):
            parts = line.rstrip("\n").split("\t")
            if len(parts) == 2: ocr += norm(parts[1])
    rows, rejected = [], []
    for f in sorted(glob.glob(os.path.join(d, "judge-*.json"))):
        name = os.path.basename(f)[6:-5]
        try: j = json.load(open(f, encoding="utf-8"))
        except Exception as e:
            rejected.append((name, f"読めない: {e}")); continue
        vt = [t for t in j.get("visible_text", []) if norm(t)]
        hit = sum(1 for t in vt if norm(t) in ocr)
        if not vt or hit / len(vt) < 0.6:
            rejected.append((name, f"画面に無い文字を根拠にした（照合 {hit}/{len(vt)}）")); continue
        rows.append(j)
    return rows, rejected

def med(rows, group, key):
    vals = [r.get(group, {}).get(key, 0) for r in rows]
    vals = [v for v in vals if 1 <= v <= 7]
    return statistics.median(vals) if vals else None

variants = ["base"] + sorted(
    os.path.basename(p) for p in glob.glob(os.path.join(ROOT, "*"))
    if os.path.isdir(p) and os.path.basename(p) != "base")
data = {}
print(f"== 案の比較 — {ROOT} ==\n")
for v in variants:
    rows, rej = load(v)
    for n, why in rej: print(f"  無効 {v}/{n}: {why}")
    if not rows: continue
    t = {k: med(rows, "trust", k) for k in TRUST}
    g = {k: med(rows, "scores", k) for k in GUARD}
    got = [x for x in t.values() if x is not None]
    data[v] = {"n": len(rows), "trust": t, "guard": g,
               "trust_mean": round(statistics.mean(got), 2) if got else None,
               "weaknesses": [w for r in rows for w in r.get("weaknesses", [])]}

if "base" not in data:
    print("base が採点されていない。比べられない。"); sys.exit(1)

hdr = "  " + "".ljust(26) + "".join(v.ljust(8) for v in variants if v in data)
print(hdr)
for k in TRUST:
    line = "  " + k.ljust(26)
    for v in variants:
        if v not in data: continue
        x = data[v]["trust"][k]
        line += (f"{x:.1f}" if x is not None else "-").ljust(8)
    print(line)
line = "  " + "狙い（平均）".ljust(24)
for v in variants:
    if v in data: line += f"{data[v]['trust_mean']:.2f}".ljust(8)
print("\n" + line)
print()
for k in GUARD:
    line = "  " + ("壊れ: " + k).ljust(26)
    for v in variants:
        if v not in data: continue
        x = data[v]["guard"][k]
        line += (f"{x:.1f}" if x is not None else "-").ljust(8)
    print(line)

base = data["base"]
print("\n-- 採否 --")
best, best_gain = None, 0
for v in variants[1:]:
    if v not in data: continue
    gain = data[v]["trust_mean"] - base["trust_mean"]
    reg = []
    for k in GUARD:
        a, b = base["guard"][k], data[v]["guard"][k]
        if a is None or b is None: continue
        if b - a < -0.15: reg.append(f"{k} {b-a:+.1f}")
    ok = gain >= 0.25 and not reg
    why = []
    if gain < 0.25: why.append(f"狙い {gain:+.2f}（+0.25 未満）")
    if reg: why.append("壊した: " + ", ".join(reg))
    print(f"  {v}: 狙い {gain:+.2f}  {'採用可' if ok else '不採用 — ' + ' / '.join(why)}")
    if ok and gain > best_gain: best, best_gain = v, gain

print()
if best:
    print(f"ADOPT={best}（狙い {best_gain:+.2f}）")
else:
    print("ADOPT=none — どの案も規則を満たさない。base のまま戻す。")
json.dump(data, open(os.path.join(ROOT, "compare.json"), "w"), ensure_ascii=False, indent=2)
