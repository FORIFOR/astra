#!/usr/bin/env bash
# HARNESS_VALIDITY_GATE — 採点する側を先に採点する。
#
# 答えの分かっている絵を評価器に見せ、当てられるかを測る。
# 当てられない評価器の点で Astra を直さない（幻を直すことになる）。
#
#   harness-validity.sh            いまの結果を出す
#   harness-validity.sh --make     fixture を Astra から作る
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
FIX="$ROOT/docs/ux-benchmark/auto/fixtures"
LAB="$ROOT/.build/uxlab"
BIN="$ROOT/apps/astra-macos/.build/debug/AstraMac"

if [ "${1:-}" = "--make" ]; then
  # fixture は**実際の Astra から作る**。手描きでは、本物を採点したときに
  # 同じ判断をする保証が無い。
  mkdir -p "$FIX/blank" "$FIX/contradiction"
  bash "$ROOT/scripts/ux-auto/build-tools.sh" >/dev/null

  # blank: 白紙かどうかを見分けられるか
  pkill -9 -f AstraMac 2>/dev/null; sleep 1
  ASTRA_DATA_ROOT="$(mktemp -d)" "$BIN" --selftest journey J05 "$(mktemp -d)/j5" >/dev/null 2>&1
  # ↑ の出力から良い絵を拾うのは面倒なので、既にある採取物を使う
  cp "$ROOT/artifacts/ux/J05/base/01-start.png" "$FIX/blank/good-meeting-start.png" 2>/dev/null
  # 白紙の bad は作る（同じ大きさの真っ白）
  python3 - "$FIX/blank/bad-blank.png" <<'PY'
import sys, subprocess, os
# 真っ白な PNG を作る（外部依存を増やさない）
w, h = 1080, 680
raw = b"\xff" * (w * h)
pgm = f"P5\n{w} {h}\n255\n".encode() + raw
p = "/tmp/_blank.pgm"; open(p, "wb").write(pgm)
subprocess.run(["sips", "-s", "format", "png", p, "--out", sys.argv[1]],
               capture_output=True)
PY
  echo '{"good-meeting-start.png":"NOT_BLANK","bad-blank.png":"BLANK"}' > "$FIX/blank/expected.json"

  # contradiction: 画面内の食い違いを見分けられるか
  pkill -9 -f AstraMac 2>/dev/null; sleep 1
  "$BIN" --selftest hold-meeting 20 silent >/dev/null 2>&1 &
  sleep 4
  r="$("$LAB/winrect")"
  [ -n "$r" ] && screencapture -x -o -l"$(echo "$r"|awk '{print $5}')" "$FIX/contradiction/good-no-audio.png" 2>/dev/null
  pkill -9 -f AstraMac 2>/dev/null
  echo '{"good-no-audio.png":"CONSISTENT"}' > "$FIX/contradiction/expected.json"
  echo "fixture を作った: $FIX"
  exit 0
fi

echo "== HARNESS_VALIDITY_GATE =="
echo
bash "$ROOT/scripts/ux-auto/build-tools.sh" >/dev/null

pass=0; total=0; fp=0; fn=0
declare -a lines

# ---- ① guard.sh（白紙を弾けるか）----
if [ -d "$FIX/blank" ]; then
  for f in "$FIX/blank"/*.png; do
    [ -f "$f" ] || continue
    name="$(basename "$f")"
    want="$(python3 -c "
import json,sys;print(json.load(open('$FIX/blank/expected.json')).get('$name',''))" 2>/dev/null)"
    [ -n "$want" ] || continue
    total=$((total+1))
    if bash "$ROOT/scripts/ux-auto/guard.sh" "$f" >/dev/null 2>&1; then got=NOT_BLANK; else got=BLANK; fi
    if [ "$got" = "$want" ]; then pass=$((pass+1)); mark="✓"
    else
      mark="✗"
      [ "$want" = "NOT_BLANK" ] && fp=$((fp+1)) || fn=$((fn+1))
    fi
    lines+=("  $mark guard/$name  期待 $want / 実際 $got")
  done
fi

# ---- ② verify-no-contradiction（食い違いを弾けるか）----
# 壊した版でも落ちることは、実際に壊して確かめてある（FINDINGS.md）。
# ここでは good が通ることだけ機械で見る。
if [ -f "$FIX/contradiction/good-no-audio.png" ]; then
  total=$((total+1))
  txt="$("$LAB/ocr" "$FIX/contradiction/good-no-audio.png" | cut -f2- | tr -d ' 　')"
  if echo "$txt" | grep -q "聞いています" && echo "$txt" | grep -q "音が届いていません"; then
    got=CONTRADICTION
  else got=CONSISTENT; fi
  if [ "$got" = "CONSISTENT" ]; then pass=$((pass+1)); mark="✓"; else mark="✗"; fp=$((fp+1)); fi
  lines+=("  $mark contradiction/good-no-audio.png  期待 CONSISTENT / 実際 $got")
fi

for l in "${lines[@]}"; do echo "$l"; done
echo
if [ "$total" -eq 0 ]; then
  echo "fixture が 0。--make で作ること。"
  echo "HARNESS_VALIDITY_GATE=UNSCORED"
  exit 0
fi
acc=$(python3 -c "print(round($pass/$total*100,1))")
fpr=$(python3 -c "print(round($fp/$total*100,1))")
fnr=$(python3 -c "print(round($fn/$total*100,1))")
printf "  正答率 %s%%（%s/%s）  false positive %s%%  false negative %s%%\n" "$acc" "$pass" "$total" "$fpr" "$fnr"
echo
ok=$(python3 -c "print(1 if $acc>=95 and $fpr<=5 and $fnr<=10 else 0)")
if [ "$ok" = "1" ]; then
  echo "HARNESS_VALIDITY_GATE=PASS"
  echo "  → この評価器の点で Astra を直してよい（AUTO_FIX_ELIGIBLE）"
else
  echo "HARNESS_VALIDITY_GATE=FAIL"
  echo "  → OBSERVATION_ONLY。見るだけで、コードを変えない"
  exit 1
fi
