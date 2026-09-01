#!/usr/bin/env bash
# Blind Operator の手足。**実装を知らない評価者**が使う 3 つの動作だけを出す。
#
#   blind.sh start [秒]     Astra を出して待つ
#   blind.sh shot <名前>    いまの画面を撮る（Astra の窓だけ。他アプリは写さない）
#   blind.sh press <x> <y>  撮った画像の座標を**意味として押す**（Vision→AX）
#   blind.sh click <x> <y>  物理クリック（この環境では届かない。press を使う）
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

# 合成クリックが本当に届くかを、**自分で作った的**で確かめる。
# Astra を的にしたままでは、道具の不備と製品の欠陥を切り分けられない。
# 実際、届かないクリックを「Astra がクリックを無視する」と 2 回記録した。
selfcheck() {
  bash "$ROOT/scripts/ux-auto/build-tools.sh" >/dev/null
  local log="$OUT/selfcheck.log"
  "$LAB/clicktest" > "$log" 2>&1 &
  sleep 2
  local t; t="$(head -1 "$log")"
  if [ -z "$t" ]; then echo "CLICK_UNKNOWN"; return 2; fi
  set -- $t
  "$LAB/uxin" click $(( $2 + 150 )) $(( $3 + 100 ))
  sleep 3
  pkill -f clicktest 2>/dev/null
  if grep -q CLICK_RECEIVED "$log"; then echo "CLICK_OK"; return 0; fi
  echo "CLICK_NOT_DELIVERED"; return 3
}

case "${1:-}" in
  selfcheck) selfcheck ;;
  start)
    pkill -9 -f AstraMac 2>/dev/null; sleep 1
    rm -f "$OUT"/*.png "$OUT"/rect.txt
    # 既定を長く取る。**評価の途中でアプリが寿命で消えると、それを製品の欠陥と
    # 読み違える**（実際そうなった: 60 秒で終了したのを「窓が二度と戻らない」と
    # 記録してしまった）。
    HOLD="${2:-900}"
    "$BIN" --selftest idle-hold "$HOLD" >"$OUT/app.log" 2>&1 &
    echo $! > "$OUT/app.pid"
    sleep 2.5
    echo "started (hold ${HOLD}s)"
    ;;
  shot)
    name="${2:-shot}"
    # **窓 ID を指定して撮る。** 画面全体を撮って切り出すと、利用者の他の窓が
    # 混ざるうえ、上に重なった別アプリごと評価してしまう。
    # 「上から覆われているか」は絵ではなく calm の coverage で測る。
    r="$("$LAB/winrect")"
    if [ -z "$r" ]; then
      # 窓が無い理由を区別する。アプリが終わっているなら、それは製品の話ではない。
      if [ -f "$OUT/app.pid" ] && ! kill -0 "$(cat "$OUT/app.pid")" 2>/dev/null; then
        echo "HARNESS_EXPIRED: 検査用のアプリが終了している（製品の不具合ではない）"; exit 2
      fi
      echo "NO_WINDOW"; exit 1
    fi
    echo "$r" > "$OUT/rect.txt"
    wid=$(echo "$r" | awk '{print $5}')
    screencapture -x -o -l"$wid" "$OUT/$name.png" 2>/dev/null
    echo "$OUT/$name.png"
    ;;
  press)
    # **発見は絵、実行だけ AX。**
    # 物理クリックが届かない環境でも「押す」遷移は試せる。
    # ここが要素の役割や説明を出すと、絵で気付けないものまで見つけられてしまい、
    # 発見性の検査が壊れる。だから **座標の解決結果しか返さない**。
    r="$(cat "$OUT/rect.txt" 2>/dev/null)"; [ -n "$r" ] || { echo "先に shot"; exit 1; }
    set -- $r "$2" "$3"
    x=$(python3 -c "print(int($1 + $6))"); y=$(python3 -c "print(int($2 + $7))")
    out="$("$LAB/axpress" "$x" "$y")"
    case "$out" in
      PRESSED*)          echo "PRESSED" ;;
      NO_PRESS_ACTION*)  echo "NOT_PRESSABLE: そこに押せるものは無い" ;;
      NO_ELEMENT*)       echo "NOTHING_THERE: そこには要素が無い" ;;
      *)                 echo "EXECUTION_FAILED: $out" ;;
    esac
    sleep 0.6
    ;;
  click)
    # 届かないクリックを「押した」と記録しない。
    if [ ! -f "$OUT/.click-ok" ]; then
      if selfcheck >/dev/null 2>&1; then touch "$OUT/.click-ok"
      else
        echo "CLICK_NOT_DELIVERED: この環境では物理クリックが届かない。"
        echo "  代わりに press を使うこと（押す遷移は試せる）。"
        echo "  押せないことを製品の欠陥として記録しない。"
        exit 4
      fi
    fi
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
  *) echo "usage: blind.sh start|shot|press|click|key|selfcheck|stop"; exit 2 ;;
esac
