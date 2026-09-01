#!/usr/bin/env python3
"""AUTO_QUALITATIVE_GATE — 人の採点なしで「高品質」と言ってよいかを決める。

自動評価は甘く出やすいので、**人の基準より高くする**。
（人 6.0 / 5.5 に対し、自動は 6.2 / 6.0 / 5.8）

判定に使うのは:
  Visual Judge の中央値（実装を知らない Judge。作り話は照合で弾いた分だけ）
  ばらつき（Judge が割れているなら、その点は信用しない）
  機械計測（焦点・窓・Blind の成功率）

使い方: auto-gate.py [artifacts/ux]
"""
import glob, json, os, statistics, sys

ROOT = sys.argv[1] if len(sys.argv) > 1 else "artifacts/ux"
CRIT = {"clarity": 6.2, "calmness": 6.2, "continuity": 6.2,
        "context": 6.2, "trust": 6.2, "control": 6.2}
OTHER = {"hierarchy": 6.0, "efficiency": 6.0, "craft": 6.0, "delight": 5.8}
FLOORS = {**CRIT, **OTHER}
MAX_SD = 0.7

# ---- Judge の点（Journey ごとの最新 iteration）----
per_axis, per_journey, missing = {a: [] for a in FLOORS}, {}, []
for jdir in sorted(glob.glob(os.path.join(ROOT, "J*"))):
    j = os.path.basename(jdir)
    latest = None
    for it in sorted(glob.glob(os.path.join(jdir, "*"))):
        if os.path.exists(os.path.join(it, "scores.json")):
            latest = os.path.join(it, "scores.json")
    if not latest:
        missing.append(j); continue
    d = json.load(open(latest))
    if not d.get("axes"):
        missing.append(j); continue
    per_journey[j] = {a: v["median"] for a, v in d["axes"].items()}
    for a, v in d["axes"].items():
        if a in per_axis:
            per_axis[a].append((j, v["median"], v["stddev"]))

# Judge がまだ検証されていない軸は、点を出しても**製品の FAIL とは言わない**。
# 製品の欠陥と測定系の未整備を混ぜないため（EVIDENCE_LEVELS.md）。
VALID = {}
for f in glob.glob("docs/ux-benchmark/auto/judge-fixtures/*/results/validity.json"):
    v = json.load(open(f))
    VALID[v["dimension"]] = v.get("passed", False)

print("== AUTO_QUALITATIVE_GATE ==\n")
if not per_journey:
    print("  採点済みの Journey が 0。")
    print("\nAUTO_QUALITATIVE_GATE=UNSCORED")
    sys.exit(0)

print("  Journey 別の中央値")
axes = list(FLOORS)
print("    " + "".ljust(6) + "".join(a[:5].ljust(7) for a in axes))
for j, sc in sorted(per_journey.items()):
    print("    " + j.ljust(6) + "".join(f"{sc.get(a, 0):.1f}".ljust(7) for a in axes))

fail, wide = [], []
print("\n  軸ごと（全 Journey をまとめた中央値）")
summary = {}
for a in axes:
    vals = [m for _, m, _ in per_axis[a]]
    if not vals:
        fail.append(f"{a} が未採点"); continue
    med = statistics.median(vals)
    summary[a] = med
    worst_sd = max((sd for _, _, sd in per_axis[a]), default=0)
    mark = ""
    validated = VALID.get(a, False)
    if not validated:
        # Evidence C。見るだけ。
        mark = "  [UNVALIDATED / Evidence C]"
    elif med < FLOORS[a]:
        fail.append(f"{a} が {med:.1f}（床 {FLOORS[a]}）"); mark = "  未達"
    if worst_sd > MAX_SD:
        wide.append(f"{a} の Judge がばらついた（stddev {worst_sd:.2f} > {MAX_SD}）")
        mark += "  ばらつき大"
    print(f"    {a.ljust(12)} {med:.1f} / 床 {FLOORS[a]}{mark}")

# ---- 機械計測 ----
print("\n  機械計測")
theft = wins = 0; journeys = 0; blind_ok = blind_n = 0
for f in glob.glob(os.path.join(ROOT, "J*", "*", "result.json")):
    d = json.load(open(f))
    theft += d.get("focusTheft", 0); wins += d.get("windowsOpened", 0); journeys += 1
print(f"    焦点を奪った       {theft}")
print(f"    増えた窓           {wins}")
if theft: fail.append(f"焦点を奪った {theft} 回（0 でなければ不合格）")
if wins: fail.append(f"窓が {wins} 個増えた（0 でなければ不合格）")

# Blind は 4 つに分ける。**測定不能を失敗に数えない。**
# 「0/4」と出していたが、そのうち物理クリックはこの環境で届かないだけで、
# 製品の失敗ではない（EVIDENCE_LEVELS.md の格 D）。
blind = {"keyboard": [0, 0], "visual_discovery": [0, 0], "ax_activation": [0, 0]}
for f in sorted(glob.glob(os.path.join(ROOT, "blind", "*", "result.json"))):
    d = json.load(open(f))
    if d.get("visual_target_found") is not None:
        blind["visual_discovery"][1] += 1
        blind["visual_discovery"][0] += 1 if d["visual_target_found"] else 0
    if d.get("semantic_activation_success") is not None:
        blind["ax_activation"][1] += 1
        blind["ax_activation"][0] += 1 if d["semantic_activation_success"] else 0
    if d.get("success") is not None:
        blind["keyboard"][1] += 1
        blind["keyboard"][0] += 1 if d["success"] else 0
for name, (ok_, n_) in blind.items():
    if n_:
        print(f"    Blind {name:16} {ok_}/{n_}")
    else:
        print(f"    Blind {name:16} 未計測")
print("    Blind physical_pointer   NOT_MEASURED（この環境では合成クリックが届かない）")
# 発見（絵から見つけられたか）だけは UI の話なので床を課す。
vd_ok, vd_n = blind["visual_discovery"]
if vd_n and vd_ok / vd_n < 0.95:
    fail.append(f"Blind の視覚的発見 {vd_ok}/{vd_n}（95% 未満）")
elif not vd_n:
    print("    （視覚的発見の記録が無い。Blind Operator を走らせること）")

cal = os.path.join(ROOT, "calmness", "metrics.json")
if os.path.exists(cal):
    c = json.load(open(cal))
    print(f"    占有の最大         {c['occupation_max']*100:.1f}%")
    print(f"    勝手に広がった     {c['unexpected_expansion']}")
    if c["focus_theft"]: fail.append(f"CALMNESS 焦点 {c['focus_theft']} 回")
    if c["unexpected_expansion"]: fail.append("CALMNESS 勝手に広がった")
else:
    print("    CALMNESS_TEST      未計測"); fail.append("CALMNESS_TEST を走らせていない")

acc = os.path.join(ROOT, "accessibility.json")
if os.path.exists(acc):
    a11y = json.load(open(acc))
    print(f"    Accessibility      {a11y.get('verdict','?')}")
    if a11y.get("verdict") != "PASS": fail.append("ACCESSIBILITY_GATE が PASS でない")
else:
    print("    Accessibility      未計測"); fail.append("ACCESSIBILITY_GATE を走らせていない")

if missing:
    fail.append("未採点の Journey: " + ", ".join(missing))

print()
for w in wide: print("  注意:", w)
if fail:
    for f in fail: print("  未達:", f)
    unvalidated = [a for a in axes if not VALID.get(a, False)]
    if unvalidated:
        print("\nAUTO_QUALITATIVE_GATE=BLOCKED_BY_UNVALIDATED_JUDGE")
        print("  検証済みでない軸: " + ", ".join(unvalidated))
        print("  → 製品の FAIL ではない。**採点者がまだ検証されていない。**")
        print("     scripts/ux-auto/judge-validity.py <軸> を通してから判定する。")
        sys.exit(1)
    print("\nAUTO_QUALITATIVE_GATE=FAIL")
    # 次に直すもの: 床からの不足がいちばん大きい軸。
    gaps = sorted(((FLOORS[a] - m, a, m) for a, m in summary.items() if m < FLOORS[a]),
                  reverse=True)
    if gaps:
        print("\n  次に直す順（床からの不足が大きい順）")
        for i, (g, a, m) in enumerate(gaps[:3], 1):
            worst = sorted(((s.get(a, 9), j) for j, s in per_journey.items()))[:1]
            where = f"（最も低いのは {worst[0][1]} の {worst[0][0]:.1f}）" if worst else ""
            print(f"    {i}. {a.ljust(12)} {m:.1f} / 床 {FLOORS[a]}  不足 {g:.1f}{where}")
    sys.exit(1)
print("AUTO_QUALITATIVE_GATE=PASS")
print("  → 「自動 UX 評価において高品質」と言える。")
print("  → 「人が VoiceOS より好んだ」とは言えない（人が要る）。")
