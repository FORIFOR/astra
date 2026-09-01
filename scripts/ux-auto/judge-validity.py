#!/usr/bin/env python3
"""VISUAL_JUDGE_VALIDITY_GATE — 採点者を採点する。

Judge の点で Astra を直してよいかを決める。通らない軸は OBSERVATION_ONLY。

  pairwise_accuracy       >= 90%   good/bad を並べて、good を選べるか
  good_bad_separation     >= 1.5   絶対点の差（good 平均 - bad 平均）
  orientation_consistency >= 90%   左右を入れ替えても結論が変わらないか
  defect_localization     >= 85%   低い点の理由が、画面に在るものか
  hallucinated_evidence   <=  5%   画面に無いものを根拠にしていないか
  run_to_run_stddev       <= 0.6   Judge どうしのばらつき
  known-good 平均 >= 5.8 / known-bad 平均 <= 4.2

使い方: judge-validity.py <trust|continuity|delight>
"""
import glob, json, os, re, statistics, sys, unicodedata

DIM = sys.argv[1] if len(sys.argv) > 1 else "trust"
BASE = f"docs/ux-benchmark/auto/judge-fixtures/{DIM}"
ANS, RES = f"{BASE}/answers", f"{BASE}/results"

def norm(s):
    return re.sub(r"[\s　:：・…\.\-‐―「」\"']+", "", unicodedata.normalize("NFKC", str(s)).lower())

key = {}
for line in open(f"{ANS}/key.txt", encoding="utf-8"):
    parts = line.split()
    if len(parts) >= 2: key[parts[0]] = parts[1]
good = [k for k, v in key.items() if v == "GOOD"]
bad  = [k for k, v in key.items() if v == "BAD"]

ocr = {}
for f in glob.glob(f"{ANS}/*.ocr.txt"):
    img = os.path.basename(f).split(".")[0]
    txt = ""
    for line in open(f, encoding="utf-8"):
        p = line.rstrip("\n").split("\t")
        if len(p) == 2: txt += norm(p[1])
    ocr[img] = txt

judges = {}
for f in sorted(glob.glob(f"{RES}/judge-*.json")):
    judges[os.path.basename(f)[6:-5]] = json.load(open(f, encoding="utf-8"))

print(f"== VISUAL_JUDGE_VALIDITY_GATE — {DIM} ==\n")
if not judges:
    print("Judge の結果が 0。\n\nVISUAL_JUDGE_VALIDITY=UNSCORED"); sys.exit(0)
print(f"  fixture  good {len(good)} / bad {len(bad)} / edge {len(key)-len(good)-len(bad)}")
print(f"  Judge    {len(judges)} 体\n")

# ---- 作り話（画面に無い文字を根拠にした割合）----
# **語ごとに照合する。** 丸ごとの一致で見ると、OCR が別行に分けた 1 行を
# Judge が繋いで書いただけで「作り話」になる（実際、`Ken · 10:42 · 出所 ›` が
# そう判定された。あれは画面に在る）。
# 半分以上の語がその絵から読めていれば、根拠は画面に在ると見なす。
hall_total = hall_bad = 0
for name, j in judges.items():
    for img, texts in (j.get("visible_text") or {}).items():
        hay = ocr.get(img, "")
        for t in texts:
            if not norm(t): continue
            hall_total += 1
            words = [w for w in re.split(r"[\s·、。,]+", str(t)) if len(norm(w)) >= 1]
            hit = sum(1 for w in words if norm(w) and norm(w) in hay)
            if not words or hit / len(words) < 0.5: hall_bad += 1
hall = 100 * hall_bad / hall_total if hall_total else 0

# ---- 絶対点 ----
g_all, b_all, per_img = [], [], {}
for name, j in judges.items():
    for img, v in (j.get("absolute") or {}).items():
        if not (1 <= v <= 7): continue
        per_img.setdefault(img, []).append(v)
        if key.get(img) == "GOOD": g_all.append(v)
        if key.get(img) == "BAD":  b_all.append(v)
gm = statistics.mean(g_all) if g_all else 0
bm = statistics.mean(b_all) if b_all else 0
sep = gm - bm
sds = [statistics.pstdev(v) for v in per_img.values() if len(v) > 1]
sd = max(sds) if sds else 0

print("  絶対点（fixture ごと・Judge の並び）")
for img in sorted(per_img, key=lambda x: (key.get(x, "Z"), x)):
    print(f"    {img}  {key.get(img,'?'):5} " + " ".join(str(v) for v in per_img[img]))
print(f"\n    known-good 平均 {gm:.2f}   known-bad 平均 {bm:.2f}   分離 {sep:+.2f}")
print(f"    Judge 間の最大ばらつき {sd:.2f}")

# ---- 対比較と左右反転 ----
PAIRS = {"P1": ("A", "B"), "P2": ("B", "A"), "P3": ("A", "B"),
         "P4": ("B", "A"), "P5": ("A", "B"), "P6": ("B", "A")}
correct = total = 0
orient_ok = orient_total = 0
for name, j in judges.items():
    pw = j.get("pairwise") or {}
    for p, ans in pw.items():
        if not ans or ans == "tie": total += 1; continue
        total += 1
        if key.get(ans) == "GOOD": correct += 1
    for a, b in (("P1","P2"), ("P3","P4"), ("P5","P6")):
        if a in pw and b in pw:
            orient_total += 1
            if pw[a] == pw[b]: orient_ok += 1
pa = 100 * correct / total if total else 0
oc = 100 * orient_ok / orient_total if orient_total else 0

# ---- 根拠の所在 ----
loc_ok = loc_total = 0
for name, j in judges.items():
    for l in (j.get("localization") or []):
        loc_total += 1
        obs, img = norm(l.get("observation", "")), l.get("image", "")
        # 観察に、その絵から読める文字が含まれているか
        words = [w for w in re.split(r"[、。,\s]", str(l.get("observation", ""))) if len(norm(w)) >= 2]
        if any(norm(w) in ocr.get(img, "") for w in words): loc_ok += 1
loc = 100 * loc_ok / loc_total if loc_total else 0

print(f"\n  対比較の正答率        {pa:.1f}%  （{correct}/{total}）")
print(f"  左右を入れ替えた一致  {oc:.1f}%  （{orient_ok}/{orient_total}）")
print(f"  根拠が画面に在る割合  {loc:.1f}%  （{loc_ok}/{loc_total}）")
print(f"  画面に無い根拠        {hall:.1f}%  （{hall_bad}/{hall_total}）")

checks = [("対比較 >= 90%", pa >= 90), ("分離 >= 1.5", sep >= 1.5),
          ("左右一致 >= 90%", oc >= 90), ("根拠の所在 >= 85%", loc >= 85),
          ("作り話 <= 5%", hall <= 5), ("ばらつき <= 0.6", sd <= 0.6),
          ("known-good >= 5.8", gm >= 5.8), ("known-bad <= 4.2", bm <= 4.2)]
print()
bad_checks = [n for n, ok in checks if not ok]
for n, ok in checks: print(f"  {'✓' if ok else '✗'} {n}")
print()
out = {"dimension": DIM, "pairwise_accuracy": round(pa,1), "separation": round(sep,2),
       "orientation_consistency": round(oc,1), "localization": round(loc,1),
       "hallucinated": round(hall,1), "max_stddev": round(sd,2),
       "good_mean": round(gm,2), "bad_mean": round(bm,2),
       "passed": not bad_checks, "failed_checks": bad_checks}
os.makedirs(RES, exist_ok=True)
json.dump(out, open(f"{RES}/validity.json", "w"), ensure_ascii=False, indent=2)
if bad_checks:
    print(f"VISUAL_JUDGE_VALIDITY({DIM})=FAIL")
    print(f"  → {DIM} は Evidence C のまま。OBSERVATION_ONLY（コードを変えない）")
    sys.exit(1)
print(f"VISUAL_JUDGE_VALIDITY({DIM})=PASS")
print(f"  → {DIM} を Evidence C → B へ昇格。A/B/C 探索を再開してよい")
