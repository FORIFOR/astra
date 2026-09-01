#!/usr/bin/env bash
# 軸ごとの fixture。**正解は作った側が知っている。**
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
BIN="$ROOT/apps/astra-macos/.build/debug/AstraMac"
LAB="$ROOT/.build/uxlab"
DIM="${1:?usage: make-submetric-fixtures.sh <continuity|delight>}"
B="$ROOT/docs/ux-benchmark/auto/judge-fixtures/$DIM"
rm -rf "$B"; mkdir -p "$B/images" "$B/answers" "$B/results"
bash "$ROOT/scripts/ux-auto/build-tools.sh" >/dev/null

shot() {
  local fx="$1" kind="$2" j="${3:-J09}" pick="${4:-01-拾ったあと.png}" tmp; tmp="$(mktemp -d)"
  pkill -9 -f AstraMac 2>/dev/null; sleep 1.2
  ASTRA_DATA_ROOT="$tmp/data" ASTRA_FIXTURE="$fx" \
    "$BIN" --selftest journey "$j" "$tmp" >/dev/null 2>&1
  [ -f "$tmp/$pick" ] || { echo "  撮れない: $kind"; return; }
  local id; id="$(python3 -c "import secrets;print(secrets.token_hex(2).upper())")"
  cp "$tmp/$pick" "$B/images/$id.png"
  echo "$id $kind" >> "$B/answers/key.txt"
  printf "  %s  %s\n" "$id" "$kind"
}

echo "== $DIM の fixture =="
case "$DIM" in
  continuity)
    shot "" GOOD
    shot "" GOOD J05 "01-start.png"
    shot bad-detached          DETACHED
    shot bad-detached          DETACHED  J05 "01-start.png"
    shot bad-mismatched-surface MISMATCHED
    shot bad-mismatched-surface MISMATCHED J05 "01-start.png"
    ;;
  delight)
    shot "" GOOD
    shot "" GOOD J05 "01-start.png"
    shot bad-uneven-padding UNEVEN_PADDING
    shot bad-decoration     DECORATION
    shot bad-misaligned     MISALIGNED
    ;;
esac
pkill -9 -f AstraMac 2>/dev/null
for f in "$B/images"/*.png; do "$LAB/ocr" "$f" > "$B/answers/$(basename "${f%.png}").ocr.txt" 2>/dev/null; done

python3 - "$B" "$DIM" <<'PY'
import json, sys, os
B, DIM = sys.argv[1], sys.argv[2]
TRUTH = {
 "continuity": {
   # one_surface: 全体が一つの面に見えるか / detached_overlay: 別窓のように浮いた要素があるか
   # consistent_style: 面どうしの素材（角丸・境界・地）が揃っているか
   "GOOD":       {"one_surface": "YES", "detached_overlay": "NO",  "consistent_style": "YES"},
   "DETACHED":   {"one_surface": "NO",  "detached_overlay": "YES", "consistent_style": "YES"},
   "MISMATCHED": {"one_surface": "YES", "detached_overlay": "NO",  "consistent_style": "NO"},
 },
 "delight": {
   # padding_even: 余白が揃っているか / aligned: 行の左端が揃っているか
   # decoration_restraint: 意味を持たない飾りが無いか
   "GOOD":           {"padding_even": "YES", "aligned": "YES", "decoration_restraint": "YES"},
   "UNEVEN_PADDING": {"padding_even": "NO",  "aligned": "YES", "decoration_restraint": "YES"},
   "DECORATION":     {"padding_even": "YES", "aligned": "YES", "decoration_restraint": "NO"},
   "MISALIGNED":     {"padding_even": "YES", "aligned": "NO",  "decoration_restraint": "YES"},
 },
}[DIM]
key = {}
for line in open(os.path.join(B, "answers", "key.txt"), encoding="utf-8"):
    p = line.split()
    if len(p) >= 2: key[p[0]] = p[1]
json.dump({i: TRUTH[k] for i, k in key.items() if k in TRUTH},
          open(os.path.join(B, "answers", "truth.json"), "w"), ensure_ascii=False, indent=2)
print(f"\n  正解表: {len(key)} 枚")
PY
