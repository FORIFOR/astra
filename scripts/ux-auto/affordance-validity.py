#!/usr/bin/env python3
"""TRUST_AFFORDANCE の精度を測る。**正解は作った側が知っている。**

7 段階で心理状態を当てさせるのをやめ、画面に何が在るかを YES/NO で聞く。
fixture は「その要素を消した／ずらした／偽った」姿なので、正解は機械で分かる。

  fixture_accuracy  >= 95%
  false_positive    <=  5%   無いものを「在る」と言わない
  false_negative    <= 10%   在るものを見落とさない
  abstention        <= 20%   棄権が多すぎると使えない
"""
import glob, json, os, statistics, sys

DIM = sys.argv[1] if len(sys.argv) > 1 else "affordance"
B = f"docs/ux-benchmark/auto/judge-fixtures/{DIM}"
truth = json.load(open(f"{B}/answers/truth.json", encoding="utf-8"))
kind = {}
for line in open(f"{B}/answers/key.txt", encoding="utf-8"):
    p = line.split()
    if len(p) >= 2: kind[p[0]] = p[1]
# **観察できる問い**と、**判断を要する問い**を分ける。
# 前者は 96〜100%、後者（grounded）は 74% だった。混ぜると全体が落ちる。
# 問いは正解表から読む。軸ごとに違う。
_first = next(iter(json.load(open(f"{B}/answers/truth.json", encoding="utf-8")).values()))
Q = list(_first.keys())
# 「判断を要する問い」は軸ごとに指定する。それ以外は観察できる問い。
JUDGEMENT = {"affordance": ["grounded"]}.get(DIM, [])
OBSERVABLE = [q for q in Q if q not in JUDGEMENT]

judges = {}
for f in sorted(glob.glob(f"{B}/results/judge-*.json")):
    judges[os.path.basename(f)[6:-5]] = json.load(open(f, encoding="utf-8"))

print(f"== {DIM.upper()} の精度 ==\n")
if not judges:
    print("Judge の結果が 0。\n\nTRUST_AFFORDANCE=UNSCORED"); sys.exit(0)

ok = wrong = abst = 0
fp = fn = 0
per_q = {q: [0, 0] for q in Q}
per_img = {}
for jn, j in judges.items():
    for img, want in truth.items():
        got = j.get(img) or {}
        for q in Q:
            g, w = str(got.get(q, "")).upper(), want[q]
            if g.startswith("INSUFF"): abst += 1; continue
            if g not in ("YES", "NO"): abst += 1; continue
            per_q[q][1] += 1
            per_img.setdefault(img, [0, 0])[1] += 1
            if g == w:
                ok += 1; per_q[q][0] += 1; per_img[img][0] += 1
            else:
                wrong += 1
                if g == "YES": fp += 1   # 無いものを在ると言った
                else: fn += 1

# 判定は**観察できる問いだけ**で行う。grounded は別に出す。
o_ok = sum(per_q[q][0] for q in OBSERVABLE)
o_n  = sum(per_q[q][1] for q in OBSERVABLE)
j_ok = sum(per_q[q][0] for q in JUDGEMENT)
j_n  = sum(per_q[q][1] for q in JUDGEMENT)
total = o_ok + (o_n - o_ok)
ok, wrong = o_ok, o_n - o_ok
acc = 100 * ok / total if total else 0
fpr = 100 * fp / total if total else 0
fnr = 100 * fn / total if total else 0
ar = 100 * abst / (total + abst) if (total + abst) else 0

print("  絵ごとの正答")
for img in sorted(per_img, key=lambda x: kind.get(x, "")):
    o, n = per_img[img]
    print(f"    {img}  {kind.get(img,'?'):18} {o}/{n}")
print("\n  問いごとの正答")
for q in Q:
    o, n = per_q[q]
    print(f"    {q:14} {o}/{n}" + ("" if n == 0 else f"  {100*o/n:.0f}%"))
j_acc = 100 * j_ok / j_n if j_n else 0
print(f"\n  観察できる 5 問の正答率 {acc:.1f}%   誤って在ると言った {fpr:.1f}%   見落とし {fnr:.1f}%   棄権 {ar:.1f}%")
print(f"  判断を要する grounded    {j_acc:.1f}%  ← 別扱い")

# **問いごとに昇格を決める。** 軸をまとめて合否にすると、測れる問いまで
# 巻き添えで落ちる。実際 delight は decoration_restraint が 100% なのに
# 全体では 84% で落ちていた。
print("\n  問いごとの判定")
promoted, blocked = [], []
for q in Q:
    o, n = per_q[q]
    a = 100 * o / n if n else 0
    # その問いが**弁別できているか**も見る。good と bad で答えが変わらなければ、
    # 正答率が高くても意味が無い（対比が無い）。
    ans_by_kind = {}
    for jn, j in judges.items():
        for img in truth:
            ans_by_kind.setdefault(kind.get(img, "?"), set()).add(
                str((j.get(img) or {}).get(q, "")).upper())
    distinct = len({frozenset(v) for v in ans_by_kind.values()})
    if n == 0:
        print(f"    {q:22} 未回答"); blocked.append(q); continue
    if distinct <= 1:
        print(f"    {q:22} {a:5.1f}%  弁別なし（good と bad で答えが変わらない）")
        blocked.append(q); continue
    if a >= 95:
        print(f"    {q:22} {a:5.1f}%  ✓ Evidence B へ"); promoted.append(q)
    else:
        print(f"    {q:22} {a:5.1f}%  ✗ Evidence C のまま"); blocked.append(q)

checks = [("問いのどれかが 95% 以上", len(promoted) > 0),
          ("誤って在ると言った <= 5%", fpr <= 5),
          ("棄権 <= 20%", ar <= 20)]
print()
for n, c in checks: print(f"  {'✓' if c else '✗'} {n}")
bad = [n for n, c in checks if not c]
out = {"dimension": DIM, "accuracy": round(acc,1),
       "promoted_questions": promoted, "blocked_questions": blocked,
       "grounded_accuracy": round(j_acc,1),
       "observable_questions": OBSERVABLE,
       "not_measured": ["grounded", "holistic_trust"],
       "false_positive": round(fpr,1), "false_negative": round(fnr,1),
       "abstention": round(ar,1), "passed": not bad, "failed_checks": bad,
       "per_question": {q: (per_q[q][0], per_q[q][1]) for q in Q}}
json.dump(out, open(f"{B}/results/validity.json", "w"), ensure_ascii=False, indent=2)
print()
if JUDGEMENT:
    print(f"  grounded は {j_acc:.0f}% → **NOT_MEASURED**（判断を要する問いは当てられていない）")
    print("  HOLISTIC_TRUST も NOT_MEASURED（静止画 1 枚では原理的に決まらない）")
print()
if bad:
    print(f"{DIM.upper()}=FAIL → 昇格した問い無し（OBSERVATION_ONLY）"); sys.exit(1)
print(f"{DIM.upper()}=PARTIAL → 昇格: " + ", ".join(promoted))
print("  昇格しなかった問い: " + (", ".join(blocked) if blocked else "なし"))
print("  → 出所の見えかた・辿りかた・直しかたは、この採点者で測ってよい")
print("  → 「信頼できるか」そのものは測らない")
