#!/usr/bin/env bash
# Astra 側の Journey を全部走らせて記録する。
#
# 競合は動かせない（この機械に無い）。**取れないものは取れないと記録する**ので、
# 実行できなかった Journey が「0 点の勝ち」に化けることはない。
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BIN="$ROOT/apps/astra-macos/.build/debug/AstraMac"
OUT="$ROOT/docs/ux-benchmark/astra"
JOURNEYS="${*:-J01 J02 J03 J04 J05 J06 J07 J08 J09 J10}"

[[ -x "$BIN" ]] || { echo "FAIL: 先に swift build --package-path apps/astra-macos" >&2; exit 1; }

pkill -9 -f AstraMac 2>/dev/null; sleep 1
for j in $JOURNEYS; do
  rm -rf "$OUT/$j"
  line="$("$BIN" --selftest journey "$j" "$OUT/$j" 2>&1 | grep -E '^JOURNEY|^SELFTEST_SKIP' | head -1)"
  echo "  ${line:-$j: 記録できない}"
  pkill -9 -f AstraMac 2>/dev/null; sleep 0.4
done

echo
bash "$ROOT/scripts/ux-benchmark-report.sh"
