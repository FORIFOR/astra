#!/usr/bin/env bash
# Trust Affordance の fixture。**正解は作った側が知っている。**
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
BIN="$ROOT/apps/astra-macos/.build/debug/AstraMac"
LAB="$ROOT/.build/uxlab"
B="$ROOT/docs/ux-benchmark/auto/judge-fixtures/affordance"
rm -rf "$B"; mkdir -p "$B/images" "$B/answers" "$B/results"
bash "$ROOT/scripts/ux-auto/build-tools.sh" >/dev/null

shot() {  # <fixture> <型> [撮る絵]
  local fx="$1" kind="$2" pick="${3:-01-拾ったあと.png}" tmp; tmp="$(mktemp -d)"
  pkill -9 -f AstraMac 2>/dev/null; sleep 1.2
  ASTRA_DATA_ROOT="$tmp/data" ASTRA_FIXTURE="$fx" \
    "$BIN" --selftest journey J09 "$tmp" >/dev/null 2>&1
  local src="$tmp/$pick"
  [ -f "$src" ] || { echo "  撮れない: $kind"; return; }
  local id; id="$(python3 -c "import secrets;print(secrets.token_hex(2).upper())")"
  cp "$src" "$B/images/$id.png"
  echo "$id $kind" >> "$B/answers/key.txt"
  printf "  %s  %s\n" "$id" "$kind"
}

echo "== Trust Affordance の fixture =="
shot "" GOOD
shot "" GOOD
shot bad-no-source           NO_SOURCE
shot bad-ambiguous-source    AMBIGUOUS_SOURCE
shot bad-wrong-hierarchy     WRONG_HIERARCHY
shot bad-fake-confidence     FAKE_CONFIDENCE
# 食い違いは**開かないと見えない**ので、開いた絵で撮る。
shot bad-contradictory       CONTRADICTORY  "02-原文を開いた.png"
# 比較のための、正しい開いた絵
shot ""                      GOOD_OPEN      "02-原文を開いた.png"
pkill -9 -f AstraMac 2>/dev/null
for f in "$B/images"/*.png; do "$LAB/ocr" "$f" > "$B/answers/$(basename "${f%.png}").ocr.txt" 2>/dev/null; done

# 正解表。**何を壊したかは作った側が知っている。**
python3 - "$B" <<'PY'
import json, sys, os
B = sys.argv[1]
TRUTH = {
  "GOOD":             {"speaker": "YES", "time": "YES", "to_source": "YES", "to_audio": "NO",  "to_fix": "NO",  "grounded": "YES"},
  "NO_SOURCE":        {"speaker": "NO",  "time": "NO",  "to_source": "NO",  "to_audio": "NO",  "to_fix": "NO",  "grounded": "NO"},
  "AMBIGUOUS_SOURCE": {"speaker": "YES", "time": "NO",  "to_source": "NO",  "to_audio": "NO",  "to_fix": "NO",  "grounded": "NO"},
  "WRONG_HIERARCHY":  {"speaker": "YES", "time": "YES", "to_source": "YES", "to_audio": "NO",  "to_fix": "NO",  "grounded": "NO"},
  # 「確認済み」は出るが、時刻と話者は残り、原文への道は無い。
  # 根拠を確かめる手段が無いまま確認済みと言うので grounded は NO。
  "FAKE_CONFIDENCE":  {"speaker": "YES", "time": "YES", "to_source": "NO",  "to_audio": "NO",  "to_fix": "NO",  "grounded": "NO"},
  # 開いた絵。出所も直す手段も見えるが、引いた原文が拾った文と食い違う。
  "CONTRADICTORY":    {"speaker": "YES", "time": "YES", "to_source": "YES", "to_audio": "NO",  "to_fix": "YES", "grounded": "NO"},
  "GOOD_OPEN":        {"speaker": "YES", "time": "YES", "to_source": "YES", "to_audio": "NO",  "to_fix": "YES", "grounded": "YES"},
}
key = {}
for line in open(os.path.join(B, "answers", "key.txt"), encoding="utf-8"):
    p = line.split()
    if len(p) >= 2: key[p[0]] = p[1]
json.dump({i: TRUTH[k] for i, k in key.items() if k in TRUTH},
          open(os.path.join(B, "answers", "truth.json"), "w"), ensure_ascii=False, indent=2)
print(f"\n  正解表: {len(key)} 枚（answers/truth.json）")
PY
