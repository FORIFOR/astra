#!/usr/bin/env bash
# Journey を 1 本走らせて、判定に要るものを全部採る。
#
#   静止画      各段階（Judge が見る）
#   録画        0.25 秒ごとの frame（動きは静止画に写らない）
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

# 録画は画面全体しか撮れないので、**あとで窓だけ切り出して素の録画は捨てる**。
# 利用者の他の窓（メール・端末・私物）を成果物に残さないため。
screencapture -v -V 14 -x "$OUT/raw.mov" >/dev/null 2>&1 &
SHOT=$!
T_REC=$(python3 -c "import time;print(time.time())")
sleep 1.2

T_APP=$(python3 -c "import time;print(time.time())")
"$BIN" --selftest journey "$J" "$OUT" >"$OUT/stdout.txt" 2>&1 &
APP=$!
# 走っている間に窓の位置を追う。いちばん大きく見えたものを切り出しに使う。
RECT=""; AREA=0
while kill -0 $APP 2>/dev/null; do
  r="$("$LAB/winrect" 2>/dev/null)"
  if [ -n "$r" ]; then
    a=$(echo "$r" | awk '{print $3*$4}')
    if [ "${a%.*}" -gt "$AREA" ]; then AREA=${a%.*}; RECT="$r"; fi
  fi
  sleep 0.25
done
wait $APP 2>/dev/null
T_END=$(python3 -c "import time;print(time.time())")
line="$(grep -E '^JOURNEY|^SELFTEST_SKIP' "$OUT/stdout.txt" | head -1)"

sleep 0.6
kill -INT $SHOT 2>/dev/null; wait $SHOT 2>/dev/null
pkill -9 -f AstraMac 2>/dev/null

# 0.25 秒ごとの frame。動き（morph・layout shift・遅れ）はここでしか見えない。
# **窓の矩形へ切り出す。** 画面全体のままだと、判定に関係ない他アプリが混ざり、
# しかも利用者の私物が成果物に残る。
if [ -s "$OUT/raw.mov" ]; then
  if [ -n "$RECT" ]; then
    set -- $RECT
    # 録画は物理ピクセル、窓の矩形は pt。倍率は決め打ちにせず実測する
    # （表示解像度を変えていると 2 倍とは限らない）。
    VW=$(ffprobe -v error -select_streams v:0 -show_entries stream=width -of csv=p=0 "$OUT/raw.mov")
    SW=$("$LAB/winrect" screen | awk '{print $1}')
    K=$(python3 -c "print(round($VW / $SW, 4))")
    CX=$(python3 -c "print(int($1*$K))"); CY=$(python3 -c "print(int($2*$K))")
    CW=$(python3 -c "print(int($3*$K))"); CH=$(python3 -c "print(int($4*$K))")
    echo "  窓 $1,$2 ${3}x${4} pt / 録画 ${VW}px / 倍率 ${K} → crop ${CW}x${CH}+${CX}+${CY}"
    # **失敗しても素通しにしない。** 画面全体のまま判定すると、他アプリごと採点する
    # ことになり、利用者の私物も成果物に残る。
    # **アプリが生きていた区間だけ**抜く。録画は 14 秒あるが、Journey は 2 秒ほど。
    # 全部抜くと、Astra が写っていない frame を判定に送ることになる。
    SS=$(python3 -c "print(max(0, $T_APP - $T_REC - 0.3))")
    TO=$(python3 -c "print($T_END - $T_REC + 0.3)")
    echo "  録画 ${SS}s〜${TO}s を抜く（アプリが出ていた間）"
    if ! ffmpeg -loglevel error -ss "$SS" -to "$TO" -i "$OUT/raw.mov" \
         -vf "crop=${CW}:${CH}:${CX}:${CY},fps=4,scale=960:-1" "$OUT/frames/%03d.png" 2>"$OUT/ffmpeg.log"; then
      echo "  FAIL: 窓の切り出しに失敗した。画面全体を成果物に残さないため frame を作らない。" >&2
      rm -f "$OUT/raw.mov"; exit 1
    fi
    ffmpeg -loglevel error -ss "$SS" -to "$TO" -i "$OUT/raw.mov" \
      -vf "crop=${CW}:${CH}:${CX}:${CY},scale=960:-1" -an "$OUT/window.mp4" 2>>"$OUT/ffmpeg.log"
  else
    echo "  FAIL: 窓が見つからなかった。画面全体は残さない。" >&2
    rm -f "$OUT/raw.mov"; exit 1
  fi
  # **素の録画は必ず捨てる。** 画面全体には利用者の私物が写っている。
  rm -f "$OUT/raw.mov"
fi
echo "$RECT" > "$OUT/window-rect.txt"

# 画面に写っている文字。**Judge の根拠を照合するための地の文。**
for p in "$OUT"/*.png; do
  [ -f "$p" ] || continue
  "$LAB/ocr" "$p" > "$OUT/ocr/$(basename "${p%.png}").txt" 2>/dev/null
done

frames=$(ls "$OUT/frames" 2>/dev/null | wc -l | tr -d ' ')
shots=$(ls "$OUT"/*.png 2>/dev/null | wc -l | tr -d ' ')
echo "  ${line:-$J: 記録できない}"
echo "  静止画 ${shots} / frame ${frames} / $OUT"
