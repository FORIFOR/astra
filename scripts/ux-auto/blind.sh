#!/usr/bin/env bash
# Blind Operator の手足。**実装を知らない評価者**が使う 3 つの動作だけを出す。
#
#   blind.sh start [秒]     Astra を出して待つ
#   blind.sh shot <名前>    いまの画面を撮る（Astra の窓だけ。他アプリは写さない）
#   blind.sh click <x> <y>  撮った画像の座標で押す
#   blind.sh key <名前>     ショートカットを送る（opt-space など）
#   blind.sh stop
#
# 画像の座標をそのまま渡せるようにしてある（窓の原点を足すのは中でやる）。
# 評価者に窓の位置を教えないため——それを知っているのは実装を見た者だけ。
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
LAB="$ROOT/.build/uxlab"
BIN="$ROOT/apps/astra-macos/.build/debug/AstraMac"
OUT="${BLIND_OUT:-$ROOT/artifacts/ux/blind/session}"
mkdir -p "$OUT"

case "${1:-}" in
  start)
    pkill -9 -f AstraMac 2>/dev/null; sleep 1
    rm -f "$OUT"/*.png "$OUT"/rect.txt
    "$BIN" --selftest idle-hold "${2:-180}" >"$OUT/app.log" 2>&1 &
    sleep 2.5
    echo "started"
    ;;
  shot)
    name="${2:-shot}"
    # **窓 ID を指定して撮る。** 画面全体を撮って切り出すと、利用者の他の窓が
    # 混ざるうえ、上に重なった別アプリごと評価してしまう。
    # 「上から覆われているか」は絵ではなく calm の coverage で測る。
    r="$("$LAB/winrect")"
    if [ -z "$r" ]; then echo "NO_WINDOW"; exit 1; fi
    echo "$r" > "$OUT/rect.txt"
    wid=$(echo "$r" | awk '{print $5}')
    screencapture -x -o -l"$wid" "$OUT/$name.png" 2>/dev/null
    echo "$OUT/$name.png"
    ;;
  click)
    r="$(cat "$OUT/rect.txt" 2>/dev/null)"; [ -n "$r" ] || { echo "先に shot"; exit 1; }
    set -- $r
    # 画像座標 → 画面座標。撮った画像は窓と同じ pt 寸法に見えるよう扱う。
    x=$(python3 -c "print(int($1 + ${2:-0}))"); y=$(python3 -c "print(int($2 + ${3:-0}))")
    "$LAB/uxin" click "$x" "$y"; sleep 0.5; echo "clicked"
    ;;
  key)
    case "${2:-}" in
      opt-space) "$LAB/uxin" key 49 opt ;;
      esc)       "$LAB/uxin" key 53 ;;
      enter)     "$LAB/uxin" key 36 ;;
      *) echo "unknown key"; exit 2 ;;
    esac
    sleep 0.6; echo "sent"
    ;;
  stop) pkill -9 -f AstraMac 2>/dev/null; echo "stopped" ;;
  *) echo "usage: blind.sh start|shot|click|key|stop"; exit 2 ;;
esac
