#!/usr/bin/env bash
# 3 本の Journey（J-A Task / J-B Meeting / J-C Failure）を**最後まで**通す。
#
# 画面 1 枚の検査（2pt / golden / density）は「崩れていない」しか言えない。
# ここは時間軸: 窓の数・鍵・面の座標・遷移・出所 id が段を跨いで続くか（層 A）。
# 落ちたら result.json の errors にどの段で何が切れたかが残る。
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BIN="$ROOT/apps/astra-macos/.build/debug/AstraMac"
OUT="$ROOT/docs/ux-benchmark/astra"
[[ -x "$BIN" ]] || { echo "FAIL: 先に swift build --package-path apps/astra-macos" >&2; exit 1; }
fail=0
for j in JA JB JC; do
  pkill -9 -f AstraMac 2>/dev/null; sleep 0.5
  line="$("$BIN" --selftest journey "$j" "$OUT/$j" 2>&1 | grep -E '^JOURNEY' | head -1)"
  echo "  ${line:-$j: 記録できない}"
  if ! grep -q 'success=true' <<<"$line"; then
    fail=1
    python3 - "$OUT/$j/result.json" <<'PY' 2>/dev/null || true
import json,sys
for e in json.load(open(sys.argv[1]))['errors']: print('    -', e)
PY
  fi
done
pkill -9 -f AstraMac 2>/dev/null
[ $fail -eq 0 ] && echo "JOURNEYS_OK: 3 本とも最後まで通った"
exit $fail
