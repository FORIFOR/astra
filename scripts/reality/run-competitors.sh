#!/usr/bin/env bash
# COMPETITOR_GATE — 残り 3 型（Listening / Task Running / Recovery）を、競合の**実 UI** と同じ条件で撮り、
# ブランドを消して A/B を乱数化し、3 つの vision judge の盲検にかける。人が見比べない。
#
#   bash scripts/reality/run-competitors.sh [out-dir]
#
# 前提: 競合アプリがこの Mac に入っていること（/Applications）と、各アプリを同じ archetype の状態へ
# 持っていく driver（tools/competitors/<app>.sh: 起動 → ホットキー → 状態 → 窓 id 撮影）。
# driver が無いアプリは AUTOMATION_MISSING と言う。撮れた分だけ盲検にかけ、3/3 一致 + deterministic
# evidence（寸法は occupation.py / alignment.py）でだけ FIX にする。
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
OUT="${1:-/tmp/astra-competitors}"
mkdir -p "$OUT"
apps="VoiceOS SuperIntern ChatGPT Raycast Granola"
present=(); absent=(); nodriver=()
for a in $apps; do
  if [[ -d "/Applications/$a.app" ]]; then
    if [[ -x "$ROOT/tools/competitors/$a.sh" ]]; then present+=("$a"); else nodriver+=("$a"); fi
  else absent+=("$a"); fi
done
echo "  installed with driver: ${present[*]:-none}"
echo "  installed, no driver : ${nodriver[*]:-none}"
echo "  not installed        : ${absent[*]:-none}"
if [[ ${#present[@]} -eq 0 ]]; then
  echo "AUTOMATION_MISSING: 競合 driver が 1 つも無い（tools/competitors/<app>.sh を作る。入っている: ${nodriver[*]:-none}）"
  exit 2
fi
fail=0
for a in "${present[@]}"; do
  for arch in listening task-running recovery; do
    bash "$ROOT/tools/competitors/$a.sh" "$arch" "$OUT/$a" || { echo "  $a/$arch: 撮れない"; fail=1; }
  done
done
[[ $fail -eq 0 ]] || { echo "COMPETITOR_GATE=FAIL"; exit 1; }
# 盲検（Astra 側は Atlas の同 archetype 面）。
bash "$ROOT/scripts/ux-auto/compare-blind.sh" "$OUT" || exit 1
echo "COMPETITOR_GATE=PASS"
