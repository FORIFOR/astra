#!/usr/bin/env bash
# Journey を 1 本走らせて、判定に要るものを全部採る。
#
#   静止画      各段階（Judge が見る）
#   連写        0.25 秒ごとに**窓だけ**を撮る（動きは静止画に写らない）
#   機械計測    窓・焦点・所要（result.json）
#   OCR         画面に**実際に写っている文字**。Judge の作り話を弾くのに使う
#
# 採点はしない。採る人と点を付ける人を分ける。
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
BIN="$ROOT/apps/astra-macos/.build/debug/AstraMac"
LAB="$ROOT/.build/uxlab"
J="${1:?usage: capture.sh <J05> [iter]}"
ITER="${2:-base}"
OUT="$ROOT/artifacts/ux/$J/$ITER"

[ -x "$BIN" ] || { echo "FAIL: 先に swift build --package-path apps/astra-macos" >&2; exit 1; }
bash "$ROOT/scripts/ux-auto/build-tools.sh" >/dev/null

rm -rf "$OUT"; mkdir -p "$OUT/frames" "$OUT/ocr"
pkill -9 -f AstraMac 2>/dev/null; sleep 1

# **窓だけを連写する。** 画面全体を録ると、切り出しても他アプリが写る
# （Astra が最前面でない場所では、その矩形に別のアプリが見える）。
# 実際、利用者の Finder の書類名やメールの断片が frame に入っていた。
# `screencapture -l<窓ID>` は**その窓だけ**を撮るので、他は決して入らない。
# 検査ごとに使い捨ての置き場を使う。実際の置き場へ書くと、積み上がった
# 試し録りが画面に出る（「録りかけが 397 件あります」）。
export ASTRA_DATA_ROOT="${ASTRA_DATA_ROOT:-$OUT/data}"
mkdir -p "$ASTRA_DATA_ROOT"

"$BIN" --selftest journey "$J" "$OUT" >"$OUT/stdout.txt" 2>&1 &
APP=$!
n=0
while kill -0 $APP 2>/dev/null; do
  r="$("$LAB/winrect" 2>/dev/null)"
  if [ -n "$r" ]; then
    n=$((n+1))
    screencapture -x -o -l"$(echo "$r" | awk '{print $5}')" \
      "$OUT/frames/$(printf '%03d' $n).png" 2>/dev/null
  fi
  sleep 0.25
done
wait $APP 2>/dev/null
line="$(grep -E '^JOURNEY|^SELFTEST_SKIP' "$OUT/stdout.txt" | head -1)"
pkill -9 -f AstraMac 2>/dev/null

# 画面に写っている文字。**Judge の根拠を照合するための地の文。**
for p in "$OUT"/*.png; do
  [ -f "$p" ] || continue
  "$LAB/ocr" "$p" > "$OUT/ocr/$(basename "${p%.png}").txt" 2>/dev/null
done

frames=$(ls "$OUT/frames" 2>/dev/null | wc -l | tr -d ' ')
shots=$(ls "$OUT"/*.png 2>/dev/null | wc -l | tr -d ' ')
echo "  ${line:-$J: 記録できない}"
echo "  静止画 ${shots} / frame ${frames} / $OUT"
