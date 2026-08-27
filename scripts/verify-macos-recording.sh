#!/usr/bin/env bash
# macOS の録音 E2E（Swift → astra-core → 実ディスク断片）。ライブ mic ではなく合成音源で
# 断片が実際に書かれ、回復候補に出ることを確かめる（headless で再現可能）。
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT/apps/astra-macos"
swift build >/dev/null
BIN="$(swift build --show-bin-path)/AstraMac"
OUT="$("$BIN" --selftest record)"
echo "$OUT"
[[ "$OUT" == SELFTEST_OK* ]] || { echo "FAIL: macOS recording E2E" >&2; exit 1; }
OUT2="$("$BIN" --selftest lifecycle)"
echo "$OUT2"
[[ "$OUT2" == SELFTEST_OK* ]] || { echo "FAIL: macOS lifecycle E2E" >&2; exit 1; }
OUT3="$("$BIN" --selftest shortcut)"
echo "$OUT3"
[[ "$OUT3" == SELFTEST_OK* ]] || { echo "FAIL: macOS global shortcut register" >&2; exit 1; }
OUT4="$("$BIN" --selftest sysaudio)"
echo "$OUT4"
[[ "$OUT4" == SELFTEST_OK* ]] || { echo "FAIL: macOS system-audio config" >&2; exit 1; }
OUT5="$("$BIN" --selftest calendar)"
echo "$OUT5"
[[ "$OUT5" == SELFTEST_OK* ]] || { echo "FAIL: macOS calendar status" >&2; exit 1; }
OUT6="$("$BIN" --selftest screen)"
echo "$OUT6"
[[ "$OUT6" == SELFTEST_OK* ]] || { echo "FAIL: macOS screen-context config" >&2; exit 1; }
