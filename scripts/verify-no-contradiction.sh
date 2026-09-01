#!/usr/bin/env bash
# 画面の中で言っていることが食い違わないか、**撮った絵の文字**で確かめる。
#
# 「聞いています…」と「音が届いていません」が同じ画面に出ていた。
# 同じ面の中で食い違うと、どちらも信じられなくなる。
# 状態ではなく OCR で見るのは、**出ている文字**が食い違いの本体だから。
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BIN="$ROOT/apps/astra-macos/.build/debug/AstraMac"
LAB="$ROOT/.build/uxlab"
OUT="$(mktemp -d)"
bash "$ROOT/scripts/ux-auto/build-tools.sh" >/dev/null

pkill -9 -f AstraMac 2>/dev/null; sleep 1
# **音が来ていない状態**で会議の面を出す。J05 は音ありの姿を作るので、
# そこで試しても矛盾の起きる条件を通らない（実際、壊しても落ちなかった）。
"$BIN" --selftest hold-meeting 25 silent >/dev/null 2>&1 &
sleep 4
r="$("$LAB/winrect")"
if [ -z "$r" ]; then echo "FAIL: 窓が出ていない"; pkill -9 -f AstraMac; exit 1; fi
screencapture -x -o -l"$(echo "$r" | awk '{print $5}')" "$OUT/01-start.png" 2>/dev/null
pkill -9 -f AstraMac 2>/dev/null

shot="$OUT/01-start.png"
[ -f "$shot" ] || { echo "FAIL: 画面を撮れていない"; exit 1; }
txt="$("$LAB/ocr" "$shot" | cut -f2- | tr -d ' 　')"

# いまの不変条件: **音が 1 フレームも来ていないなら「聞いています」と言わない。**
#
# 以前は「聞いています」と「音が届いていません」が同じ画面に出ることを見ていたが、
# 見出し側の文言を消したので、その組み合わせは起こらなくなった。
# 組み合わせを見る歯止めは、条件が消えた瞬間に**素通りする**（実際そうなった）。
# 見るのは組み合わせではなく、状態と文言の対応にする。
fail=0
if echo "$txt" | grep -q "聞いています"; then
  echo "FAIL: 音が来ていないのに「聞いています」と出ている"
  fail=1
fi
if ! echo "$txt" | grep -q "まだ音が届いていません"; then
  echo "FAIL: 音が来ていないのに、そう言っていない"
  fail=1
fi
if [ "$fail" = "0" ]; then
  echo "NO_CONTRADICTION_OK: 画面の中で言っていることが食い違わない"
else
  echo "  絵: $shot"
  exit 1
fi
