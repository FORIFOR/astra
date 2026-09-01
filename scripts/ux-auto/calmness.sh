#!/usr/bin/env bash
# CALMNESS_TEST — Astra を出したまま普通に仕事をして、邪魔をしないか測る。
#
# 人が 5 分 Finder を触る代わり。**測れるものだけ測り、測れないものは
# 測れないと書く**（キーボード横取りと pointer 横取りは、外から観測する
# 手段がこの環境に無い）。
#
#   使い方: calmness.sh [秒数]  既定 60。ゲート用は 300。
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
LAB="$ROOT/.build/uxlab"
BIN="$ROOT/apps/astra-macos/.build/debug/AstraMac"
DUR="${1:-60}"
OUT="$ROOT/artifacts/ux/calmness"
mkdir -p "$OUT"

bash "$ROOT/scripts/ux-auto/build-tools.sh" >/dev/null
pkill -9 -f AstraMac 2>/dev/null; sleep 1

# Astra を出したまま置く。ここで前へ出てきたら、それが「邪魔」。
"$BIN" --selftest idle-hold $((DUR+30)) >"$OUT/app.log" 2>&1 &
APP=$!
sleep 2

APPS=("Finder" "Safari" "Notes" "Mail")
: > "$OUT/samples.tsv"
printf "t\toccupation\tocclusion\tfrontmost\tastraFront\twindows\tcoverage\n" >> "$OUT/samples.tsv"

start=$(python3 -c "import time;print(time.time())")
i=0
while :; do
  now=$(python3 -c "import time;print(time.time())")
  el=$(python3 -c "print(round($now-$start,1))")
  done_=$(python3 -c "print(1 if $el >= $DUR else 0)")
  [ "$done_" = "1" ] && break

  # 数秒ごとに別のアプリへ切り替える（人が仕事をしているのに相当）。
  if [ $((i % 8)) -eq 0 ]; then
    open -a "${APPS[$(( (i/8) % ${#APPS[@]} ))]}" 2>/dev/null
  fi

  eval "$("$LAB/calm" | sed 's/^/S_/')"
  printf "%s\t%s\t%s\t%s\t%s\t%s\t%s\n" "$el" "$S_occupation" "$S_occlusion" \
         "$S_frontmost" "$S_astraFrontmost" "$S_astraWindows" "$S_coverage" >> "$OUT/samples.tsv"
  i=$((i+1)); sleep 1
done

kill $APP 2>/dev/null; pkill -9 -f AstraMac 2>/dev/null

python3 - "$OUT" <<'PY'
import sys, os, json, statistics
d = sys.argv[1]
rows = [l.rstrip("\n").split("\t") for l in open(os.path.join(d, "samples.tsv"))][1:]
if not rows:
    print("FAIL: 標本が取れていない"); sys.exit(1)
occ = [float(r[1]) for r in rows]
ocl = [float(r[2]) for r in rows]
theft = sum(1 for r in rows if r[4] == "true")
wins = [int(r[5]) for r in rows]
cov = [float(r[6]) for r in rows if len(r) > 6]
# 突然の膨張: 1 標本で占有が 5 ポイント以上増えた回数。
jumps = sum(1 for a, b in zip(occ, occ[1:]) if b - a > 0.05)

m = {
  "samples": len(rows),
  "occupation_max": round(max(occ), 4),
  "occupation_mean": round(statistics.mean(occ), 4),
  "occlusion_max": round(max(ocl), 4),
  "focus_theft": theft,
  "unexpected_expansion": jumps,
  "windows_max": max(wins),
  # **見えているか。** 落ち着いていても、他の窓に覆われて見えないなら
  # 「邪魔をしない」ではなく「気付けない」。別の欠陥として出す。
  "coverage_max": round(max(cov), 4) if cov else None,
  "coverage_mean": round(statistics.mean(cov), 4) if cov else None,
  "not_measured": [
    "キーボードの横取り（外から観測する手段がこの環境に無い）",
    "pointer の横取り（同上）",
  ],
}
json.dump(m, open(os.path.join(d, "metrics.json"), "w"), ensure_ascii=False, indent=2)

print("== CALMNESS_TEST ==")
for k in ["samples","occupation_max","occupation_mean","occlusion_max",
          "focus_theft","unexpected_expansion","windows_max",
          "coverage_max","coverage_mean"]:
    print(f"  {k:22s} {m[k]}")
for n in m["not_measured"]:
    print(f"  未計測                 {n}")

fail = []
if m["focus_theft"] > 0: fail.append(f"焦点を奪った {m['focus_theft']} 回")
if m["unexpected_expansion"] > 0: fail.append(f"勝手に広がった {m['unexpected_expansion']} 回")
if m["occupation_max"] >= 0.10: fail.append(f"占有 {m['occupation_max']*100:.1f}%（10% 以上）")
if m["coverage_mean"] is not None and m["coverage_mean"] > 0.5:
    fail.append(f"他の窓に平均 {m['coverage_mean']*100:.0f}% 覆われていた（見えていない）")
print()
if fail:
    for f in fail: print("  未達:", f)
    print("\nCALMNESS_GATE=FAIL"); sys.exit(1)
print("CALMNESS_GATE=PASS")
PY
