#!/usr/bin/env bash
# Qualitative Gate — 「高品質な UI である」と言ってよいかを決める。
#
# **採点するのは人。** アシスタントは点を付けない。ここがやるのは、
# 人が置いた採点票を集計して合否を出すことと、各軸に**機械で測れる事実**を
# 添えることだけ。事実と評価は混ぜない。
#
# レビュアーが 0 人なら UNSCORED。**0 人を合格にしない。**
# 3 人揃うまで PASS を出さない（1 人の点を平均と呼ばない）。
#
# QUALITATIVE_UI_GATE:
#   Critical  clarity/calmness/continuity/context/trust/control >= 6.0
#   その他     hierarchy/efficiency/craft/delight               >= 5.5
#   毎日使いたいか                                              >= 6.0
#   1 つでも下回れば FAIL。レビュアー 3 人未満でも FAIL。
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
  # 「出所が付いている」ではなく「**辿って確かめられる**」を出す。
  # 付いていても開けなければ、信じるしかない点は変わらない。
  printf "  %-14s 出所を辿れる %s（未計測 %s 件）\n" "Trust" \
    "$([ "$ok" = True ] && echo はい || echo いいえ)" "$miss"
  python3 -c "
import json
d=json.load(open('$journeys/J09/result.json'))
for m in d['notMeasured']: print('                 未計測:', m)" 2>/dev/null
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

# ---- 採点票の集計（QUALITATIVE_UI_GATE）----
python3 - "$Q" <<'PYEOF'
"""QUALITATIVE_UI_GATE。人が入れた採点票を集計して合否と**次に直す順**を出す。

アシスタントは点を付けない。ここがやるのは集計だけ。
3 人揃うまで PASS を出さない（1 人の点を平均と呼ばない）。
"""
import glob, os, re, sys, statistics

Q = sys.argv[1]
CRITICAL = ["clarity", "calmness", "continuity", "context", "trust", "control"]
OTHERS = ["hierarchy", "efficiency", "craft", "delight"]
AXES = CRITICAL + OTHERS
SCENARIOS = ["R01_first_impression", "R02_voice_discovery", "R03_listening",
             "R04_agent", "R05_meeting_start", "R06_provenance",
             "R07_correction", "R08_recovery", "R09_calmness", "R10_preference"]
NEEDED = 3

def load(path):
    """依存を増やさないための最小限の読み取り。score: N と daily_use_preference。"""
    axes, scen, daily = {}, {}, None
    for line in open(path, encoding="utf-8"):
        s = line.strip()
        if s.startswith("#"):
            continue
        m = re.match(r"daily_use_preference:\s*(\d+)", s)
        if m:
            daily = int(m.group(1)); continue
        m = re.match(r"([A-Za-z0-9_]+):\s*\{.*?score:\s*(\d+)", s)
        if not m:
            continue
        key, val = m.group(1), int(m.group(2))
        if key in AXES:
            axes[key] = val
        elif key in SCENARIOS:
            scen[key] = val
    return axes, scen, daily

files = sorted(f for f in glob.glob(os.path.join(Q, "reviews", "*.yaml"))
               if "_template" not in os.path.basename(f))

if not files:
    print("""-- 採点 --
  レビュアー 0 人。

  「高品質な UI である」は人が採点して初めて言える。
  アシスタントが自分で点を付けても根拠にならないので、ここでは付けない。

  やること:
    1. docs/ux-benchmark/qualitative/PROTOCOL.md の R01〜R10 を実施（15〜20 分）
    2. reviews/_template.yaml を複製し、観察を書いてから 10 軸へ点を付ける
    3. 3 人分そろったら再実行

QUALITATIVE_UI_GATE=UNSCORED（レビュアー 0 人／必要 3 人）""")
    sys.exit(0)

rows, incomplete = [], []
for f in files:
    axes, scen, daily = load(f)
    name = os.path.basename(f)[:-5]
    missing = [a for a in AXES if axes.get(a, 0) < 1]
    missing_s = [r for r in SCENARIOS if scen.get(r, 0) < 1]
    if missing or daily in (None, 0) or missing_s:
        incomplete.append((name, missing, missing_s, daily))
    rows.append((name, axes, scen, daily))

print(f"-- 採点（レビュアー {len(files)} 人／必要 {NEEDED} 人）--\n")

# 軸ごとの表。**平均だけ見ない。** 誰か 1 人が低いのは、平均に埋もれる。
w = max(12, max(len(r[0]) for r in rows) + 1)
print("  " + "軸".ljust(14) + "".join(r[0][:w-1].ljust(w) for r in rows) + "平均")
means = {}
for a in AXES:
    vals = [r[1].get(a, 0) for r in rows]
    got = [v for v in vals if v >= 1]
    m = statistics.mean(got) if got else 0.0
    means[a] = m if got else None
    cells = "".join((str(v) if v >= 1 else "-").ljust(w) for v in vals)
    tag = " Critical" if a in CRITICAL else ""
    print(f"  {a.ljust(14)}{cells}{m:.1f}{tag}" if got
          else f"  {a.ljust(14)}{cells}未回答{tag}")

dailies = [r[3] for r in rows if r[3]]
daily_mean = statistics.mean(dailies) if dailies else None
print("\n  " + "毎日使いたい".ljust(12)
      + "".join((str(r[3]) if r[3] else "-").ljust(w) for r in rows)
      + (f"{daily_mean:.1f}" if daily_mean is not None else "未回答"))

# ---- 合否 ----
fail = []
for a in CRITICAL:
    m = means[a]
    if m is None: fail.append(f"{a} が未回答")
    elif m < 6.0: fail.append(f"{a}（Critical）が {m:.1f}（6.0 未満）")
for a in OTHERS:
    m = means[a]
    if m is None: fail.append(f"{a} が未回答")
    elif m < 5.5: fail.append(f"{a} が {m:.1f}（5.5 未満）")
if daily_mean is None: fail.append("毎日使いたいか が未回答")
elif daily_mean < 6.0: fail.append(f"毎日使いたいか が {daily_mean:.1f}（6.0 未満）")
if len(files) < NEEDED: fail.append(f"レビュアーが {len(files)} 人（{NEEDED} 人未満）")
for name, missing, missing_s, daily in incomplete:
    if missing: fail.append(f"{name}: 軸が未回答 {', '.join(missing)}")
    if missing_s: fail.append(f"{name}: 場面が未実施 {', '.join(missing_s)}")
    if daily in (None, 0): fail.append(f"{name}: 毎日使いたいか が未回答")

# ---- 次に直す順。**低い軸から。** 平均が足りていても弱点は弱点。----
scored = [(a, m) for a, m in means.items() if m is not None]
if scored:
    print("\n-- 次に直す順（低い軸から。合否とは別に見る）--")
    for i, (a, m) in enumerate(sorted(scored, key=lambda x: x[1])[:4], 1):
        floor = 6.0 if a in CRITICAL else 5.5
        gap = floor - m
        state = f"{gap:.1f} 足りない" if gap > 0 else "床は超えている"
        print(f"  {i}. {a.ljust(12)} {m:.1f} / 7   （{state}）")
    print("\n  各レビュアーの suggest 欄を読むこと。点だけでは何を直すか決まらない。")

print()
if fail:
    for f_ in fail: print("  未達:", f_)
    print("\nQUALITATIVE_UI_GATE=FAIL")
    sys.exit(1)
print("QUALITATIVE_UI_GATE=PASS")
print("  → 「Astra は内部定性評価において高品質な UI 基準を満たした」と言える。")
print("  → 「SuperIntern より優れている」とは**まだ言わない**（実機比較が要る）。")
PYEOF
