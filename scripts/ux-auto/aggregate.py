#!/usr/bin/env python3
"""Judge の出力を突き合わせて中央値を出す。

**画面に無いものを根拠にした採点は捨てる。** 実装を知らない Judge でも、
画像から読めないものを補って書くことはある。`visible_text` を OCR と
照合し、通らない Judge はその回を無効にする。

使い方: aggregate.py <artifacts/ux/J05/base>
"""
import json, glob, os, re, statistics, sys, unicodedata

d = sys.argv[1]
MIN_MATCH = 0.6   # visible_text のうち OCR で裏が取れる割合

def norm(s):
    s = unicodedata.normalize("NFKC", s).lower()
    return re.sub(r"[\s　:：・…\.\-‐―]+", "", s)

ocr = ""
for f in glob.glob(os.path.join(d, "ocr", "*.txt")):
    for line in open(f, encoding="utf-8"):
        parts = line.rstrip("\n").split("\t")
        if len(parts) == 2:
            ocr += norm(parts[1])

judges, rejected = {}, []
for f in sorted(glob.glob(os.path.join(d, "judge-*.json"))):
    name = os.path.basename(f)[6:-5]
    try:
        j = json.load(open(f, encoding="utf-8"))
    except Exception as e:
        rejected.append((name, f"JSON が読めない: {e}")); continue
    vt = [t for t in j.get("visible_text", []) if norm(t)]
    if len(vt) < 3:
        rejected.append((name, "visible_text が 3 個未満（照合できない）")); continue
    hit = sum(1 for t in vt if norm(t) in ocr)
    ratio = hit / len(vt)
    if ratio < MIN_MATCH:
        miss = [t for t in vt if norm(t) not in ocr][:4]
        rejected.append((name, f"画面に無い文字を根拠にした（照合 {hit}/{len(vt)}）例: {miss}"))
        continue
    judges[name] = (j.get("scores", {}), ratio, j.get("weaknesses", []))

AXES = ["clarity","calmness","continuity","context","trust",
        "control","hierarchy","efficiency","craft","delight"]

print(f"== Visual Judge 集計 — {os.path.relpath(d)} ==\n")
for name, why in rejected:
    print(f"  無効 {name}: {why}")
if rejected: print()

if not judges:
    print("有効な Judge が 0。採点しない。")
    json.dump({"valid": 0}, open(os.path.join(d, "scores.json"), "w"))
    sys.exit(0)

names = sorted(judges)
w = max(8, max(len(n) for n in names) + 1)
print("  " + "軸".ljust(13) + "".join(n.ljust(w) for n in names) + "中央値  ばらつき")
out = {}
for a in AXES:
    vals = [judges[n][0].get(a, 0) for n in names]
    got = [v for v in vals if 1 <= v <= 7]
    if not got:
        print(f"  {a.ljust(13)}" + "".join("-".ljust(w) for _ in names) + "未回答"); continue
    med = statistics.median(got)
    sd = statistics.pstdev(got) if len(got) > 1 else 0.0
    out[a] = {"median": med, "stddev": round(sd, 2), "values": got}
    flag = "  ばらつき大" if sd > 0.7 else ""
    print(f"  {a.ljust(13)}" + "".join(str(v).ljust(w) for v in vals) + f"{med:.1f}     {sd:.2f}{flag}")

meta = {"valid": len(judges), "rejected": [{"judge": n, "why": r} for n, r in rejected],
        "axes": out,
        "weaknesses": [w_ for n in names for w_ in judges[n][2]]}
json.dump(meta, open(os.path.join(d, "scores.json"), "w"), ensure_ascii=False, indent=2)
print(f"\n  有効 {len(judges)} / 無効 {len(rejected)} → {os.path.join(os.path.relpath(d),'scores.json')}")
