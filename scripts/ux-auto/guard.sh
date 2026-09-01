#!/usr/bin/env bash
# 撮ったものが**判定に出せる絵か**を確かめる。
#
# 白紙を Judge へ送ると、Judge は白紙を採点する（低い点が出て、そこを直しにいく）。
# 実際、AX で押した先がシークレットモードを有効にし、以後の撮影が全部白紙になった。
# 気付いたのは絵を見たからで、機械は何も言わなかった。
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
LAB="$ROOT/.build/uxlab"
bash "$ROOT/scripts/ux-auto/build-tools.sh" >/dev/null

# ① シークレットモードが入っていると窓は撮影に写らない。
sm="$(defaults read AstraMac astra.secretMode 2>/dev/null || echo 0)"
if [ "$sm" = "1" ]; then
  echo "GUARD_FAIL: シークレットモードが有効。窓は撮影に写らない。"
  echo "  戻す: defaults write AstraMac astra.secretMode -bool false"
  exit 1
fi

# ② 渡された絵が白紙でないか（読める文字が 3 個未満なら白紙とみなす）。
bad=0
for p in "$@"; do
  [ -f "$p" ] || { echo "GUARD_FAIL: $p が無い"; bad=1; continue; }
  n=$("$LAB/ocr" "$p" 2>/dev/null | wc -l | tr -d ' ')
  if [ "${n:-0}" -lt 3 ]; then
    echo "GUARD_FAIL: $(basename "$p") から文字が $n 個しか読めない（白紙の疑い）"
    bad=1
  fi
done
[ "$bad" = "0" ] && echo "GUARD_OK: 判定に出せる" || exit 1
