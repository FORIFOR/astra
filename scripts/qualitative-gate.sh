#!/usr/bin/env bash
# Qualitative Gate — 「高品質な UI である」と言ってよいかを決める。
#
# **採点するのは人。** アシスタントは点を付けない。ここがやるのは、
# 人が置いた採点票を集計して合否を出すことと、各軸に**機械で測れる事実**を
# 添えることだけ。事実と評価は混ぜない。
#
# レビュアーが 0 人なら UNSCORED。**0 人を合格にしない。**
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
Q="$ROOT/docs/ux-benchmark/qualitative"

echo "== Qualitative Gate =="
echo

# ---- 各軸に添える実測（採点ではない）----
echo "-- 実測（採点の材料。これ自体は点ではない）--"

geo="$ROOT/docs/golden-screenshots/geometry"
journeys="$ROOT/docs/ux-benchmark/astra"

# Continuity: 増えた窓
windows=0; measured=0
for f in "$journeys"/*/result.json; do
  [ -f "$f" ] || continue
  w="$(python3 -c "import json;print(json.load(open('$f'))['windowsOpened'])" 2>/dev/null || echo 0)"
  windows=$((windows + w)); measured=$((measured + 1))
done
printf "  %-14s 増えた窓 %s（%s Journey）\n" "Continuity" "$windows" "$measured"

# Calmness: 焦点を奪った回数
theft=0
for f in "$journeys"/*/result.json; do
  [ -f "$f" ] || continue
  t="$(python3 -c "import json;print(json.load(open('$f'))['focusTheft'])" 2>/dev/null || echo 0)"
  theft=$((theft + t))
done
printf "  %-14s 焦点を奪った回数 %s\n" "Calmness" "$theft"

# Trust: 出所の網羅率（J09 の結果から）
if [ -f "$journeys/J09/result.json" ]; then
  ok="$(python3 -c "import json;print(json.load(open('$journeys/J09/result.json'))['success'])" 2>/dev/null)"
  miss="$(python3 -c "import json;d=json.load(open('$journeys/J09/result.json'));print(len(d['notMeasured']))" 2>/dev/null)"
  printf "  %-14s 出所の付与 %s（未実装 %s 件：原文/音声/その場編集）\n" "Trust" \
    "$([ "$ok" = True ] && echo 全件 || echo 欠けあり)" "$miss"
else
  printf "  %-14s 未計測\n" "Trust"
fi

# Visual Craft: 造形ゲート
printf "  %-14s 実寸の基準 %s 状態\n" "Craft" "$(ls "$geo"/*.json 2>/dev/null | wc -l | tr -d ' ')"

# Hierarchy: 面の空き
base="$ROOT/docs/evidence/density-baseline.json"
if [ -f "$base" ]; then
  worst="$(python3 -c "
import json;d=json.load(open('$base'));k=max(d,key=d.get);print(f'{k} {d[k]}%')" 2>/dev/null)"
  printf "  %-14s 最も空いている面 %s\n" "Hierarchy" "$worst"
fi
echo

# ---- 採点票の集計 ----
files=$(ls "$Q"/reviews/*.yaml 2>/dev/null | grep -v '_template' || true)
n=$(echo "$files" | grep -c . || true)

if [ "${n:-0}" -eq 0 ]; then
  cat <<'EOF'
-- 採点 --
  レビュアー 0 人。

  「高品質な UI である」は人が採点して初めて言える。
  アシスタントが自分で点を付けても根拠にならないので、ここでは付けない。

  やること:
    docs/ux-benchmark/qualitative/reviews/_template.yaml を複製し、
    QUESTIONS.md の 10 問に答えて置く。3 人以上で集計できる。

QUALITATIVE_GATE=UNSCORED（レビュアー 0 人）
EOF
  exit 0
fi

python3 - "$Q" <<'PY'
import sys, glob, os, statistics
q = sys.argv[1]
axes = ["clarity","calmness","continuity","context","trust",
        "control","hierarchy","efficiency","craft","delight"]
critical = {"clarity","trust","control","calmness"}

def load(path):
    # 依存を増やさないための最小限の読み取り（score: N と why: を拾う）
    out, cur = {}, None
    for line in open(path, encoding="utf-8"):
        s = line.strip()
        for a in axes:
            if s.startswith(a + ":"):
                cur = a
                if "score:" in s:
                    try: out[a] = int(s.split("score:")[1].split(",")[0].strip().strip("}").strip())
                    except: pass
    return out

files = [f for f in glob.glob(os.path.join(q, "reviews", "*.yaml")) if "_template" not in f]
scores = {a: [] for a in axes}
for f in files:
    d = load(f)
    for a, v in d.items():
        if 1 <= v <= 7: scores[a].append(v)

print(f"-- 採点（レビュアー {len(files)} 人）--")
fail = []
means = []
for a in axes:
    vs = scores[a]
    if not vs:
        print(f"  {a:12s} 未回答"); fail.append(f"{a} が未回答"); continue
    m = statistics.mean(vs)
    means.append(m)
    mark = "Critical" if a in critical else ""
    print(f"  {a:12s} {m:.1f} / 7   {mark}")
    if m < 5.5: fail.append(f"{a} が {m:.1f}（5.5 未満）")
    if a in critical and m < 6.0: fail.append(f"{a}（Critical）が {m:.1f}（6.0 未満）")

overall = statistics.mean(means) if means else 0
print(f"\n  平均 {overall:.2f} / 7")
if overall < 6.0: fail.append(f"平均が {overall:.2f}（6.0 未満）")
if len(files) < 3: fail.append(f"レビュアーが {len(files)} 人（3 人未満）")

print()
if fail:
    for f in fail: print("  未達:", f)
    print("\nQUALITATIVE_GATE=FAIL")
    sys.exit(1)
print("QUALITATIVE_GATE=PASS —「高品質な UI である」と言える")
PY
