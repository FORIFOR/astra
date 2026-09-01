#!/usr/bin/env bash
# Visual Judge を試験するための絵を、**実際の Astra から**撮る。
#
# 名前は乱数の ID にする。`good.png` / `bad.png` を見せたら試験にならない。
# 正解表は Judge に渡さない場所（answers/）へ置く。
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
BIN="$ROOT/apps/astra-macos/.build/debug/AstraMac"
LAB="$ROOT/.build/uxlab"
DIM="${1:?usage: make-judge-fixtures.sh <trust|continuity|delight>}"
IMG="$ROOT/docs/ux-benchmark/auto/judge-fixtures/$DIM/images"
ANS="$ROOT/docs/ux-benchmark/auto/judge-fixtures/$DIM/answers"
rm -rf "$IMG" "$ANS"; mkdir -p "$IMG" "$ANS"
bash "$ROOT/scripts/ux-auto/build-tools.sh" >/dev/null

# 良い姿 3 枚（面を変えて撮る）／壊した姿 3 枚（同じ面を、その軸だけ壊す）
shots() {   # <fixture> <journey> <撮る名> <正解>
  local fx="$1" j="$2" pick="$3" label="$4"
  local tmp; tmp="$(mktemp -d)"
  pkill -9 -f AstraMac 2>/dev/null; sleep 1.2
  ASTRA_DATA_ROOT="$tmp/data" ASTRA_FIXTURE="$fx" \
    "$BIN" --selftest journey "$j" "$tmp" >/dev/null 2>&1
  local src="$tmp/$pick"
  [ -f "$src" ] || { echo "  撮れない: $j/$pick"; return; }
  local id; id="$(python3 -c "import secrets;print(secrets.token_hex(2).upper())")"
  cp "$src" "$IMG/$id.png"
  echo "$id $label $j/$pick $fx" >> "$ANS/key.txt"
  echo "  $id  $label"
}

echo "== $DIM の fixture を撮る =="
case "$DIM" in
  trust)
    shots none J09 "01-拾ったあと.png"   GOOD
    shots none J09 "02-原文を開いた.png" GOOD
    shots none J05 "02-notes.png"        GOOD
    shots trust-bad J09 "01-拾ったあと.png"   BAD
    shots trust-bad J09 "02-原文を開いた.png" BAD
    shots trust-bad J05 "02-notes.png"        BAD
    # 端: 拾えたものがまだ無い（出所の付けようが無い。良し悪しを言えない）
    shots none J05 "01-start.png" EDGE
    shots trust-bad J05 "01-start.png" EDGE
    ;;
  continuity)
    shots none J05 "01-start.png"  GOOD
    shots none J05 "02-notes.png"  GOOD
    shots none J09 "01-拾ったあと.png" GOOD
    shots continuity-bad J05 "01-start.png"  BAD
    shots continuity-bad J05 "02-notes.png"  BAD
    shots continuity-bad J09 "01-拾ったあと.png" BAD
    shots none J07 "01-終わったあと.png" EDGE
    shots none J10 "01-落ちたあと.png"   EDGE
    ;;
  delight)
    shots none J05 "01-start.png"  GOOD
    shots none J09 "01-拾ったあと.png" GOOD
    shots none J09 "02-原文を開いた.png" GOOD
    shots delight-bad J05 "01-start.png"  BAD
    shots delight-bad J09 "01-拾ったあと.png" BAD
    shots delight-bad J09 "02-原文を開いた.png" BAD
    shots none J07 "01-終わったあと.png" EDGE
    shots none J10 "01-落ちたあと.png"   EDGE
    ;;
esac
pkill -9 -f AstraMac 2>/dev/null
# OCR も置く（Judge の根拠を照合するため）
for f in "$IMG"/*.png; do "$LAB/ocr" "$f" > "$ANS/$(basename "${f%.png}").ocr.txt" 2>/dev/null; done
echo
echo "  絵: $IMG"
echo "  正解: $ANS/key.txt（Judge には渡さない）"
