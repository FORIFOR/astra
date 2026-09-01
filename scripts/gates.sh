#!/usr/bin/env bash
# 4 つのゲートの現在地を 1 枚で出す。
#
# 「UI が良いか」は 1 つの問いではない。造形が崩れていないこと、動くこと、
# 人が見て良いと言うこと、競合より良いことは、**別々に証明する**。
# どれかが未達なら、その上の言い方はしない（docs/ux-benchmark/CLAIMS.md）。
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

state() { printf "%-18s %-14s %s\n" "$1" "$2" "$3"; }

echo "== Astra Gates =="
echo

# ---- VISUAL: 造形が崩れていない ----
geo=$(ls "$ROOT/docs/golden-screenshots/geometry"/*.json 2>/dev/null | wc -l | tr -d ' ')
gold=$(ls "$ROOT/docs/golden-screenshots/task-dock"/*.png 2>/dev/null | wc -l | tr -d ' ')
if [ "$geo" -ge 6 ] && [ "$gold" -ge 8 ]; then
  state "VISUAL_GATE" "READY" "実寸 ${geo} 状態・正解画像 ${gold} 面（pnpm verify:all で判定）"
else
  state "VISUAL_GATE" "INCOMPLETE" "基準が足りない（実寸 ${geo} / 画像 ${gold}）"
fi

# ---- FUNCTIONAL: 動く ----
if [ -f "$ROOT/dist/Astra.app/Contents/MacOS/AstraMac" ]; then
  state "FUNCTIONAL_GATE" "READY" "配布物あり（scripts/verify-release-artifact.sh で判定）"
else
  state "FUNCTIONAL_GATE" "READY" "pnpm verify:all で判定"
fi

# ---- QUALITATIVE: 人が見て良いと言う ----
# `grep -c` は一致が無いと 1 を返して `|| echo 0` が効き、"0\n0" のような値になる。
# それを数として比べると条件が壊れ、**0 人なのに SCORED と出た**（実際そうなった）。
# 数える工程を分ける。
n=$(ls "$ROOT/docs/ux-benchmark/qualitative/reviews"/*.yaml 2>/dev/null \
    | grep -v '_template' | wc -l | tr -d ' ')
n=${n:-0}
if [ "${n:-0}" -eq 0 ]; then
  state "QUALITATIVE_UI_GATE" "UNSCORED" "レビュアー 0/3 人 → 「高品質な UI」とは言えない"
elif [ "${n:-0}" -lt 3 ]; then
  state "QUALITATIVE_UI_GATE" "INCOMPLETE" "レビュアー ${n}/3 人 → 揃うまで PASS を出さない"
else
  # 3 人揃っていても点が足りなければ FAIL。判定は本体に任せる。
  if bash "$ROOT/scripts/qualitative-gate.sh" >/dev/null 2>&1; then
    state "QUALITATIVE_UI_GATE" "PASS" "レビュアー ${n} 人・全軸が床を超えた"
  else
    state "QUALITATIVE_UI_GATE" "FAIL" "レビュアー ${n} 人・床を割った軸がある（scripts/qualitative-gate.sh）"
  fi
fi

# ---- COMPETITIVE: 競合より良い ----
# 公開素材と実機素材は**別に数える**。公開素材からは速度・焦点・成功率を
# 出せないので、同じ数に混ぜると公式サイトの 1 枚が実測に化ける。
cnt() { ls "$ROOT/docs/ux-benchmark/$1/$2"/*.png "$ROOT/docs/ux-benchmark/$1/$2"/*.mp4 2>/dev/null | wc -l | tr -d ' '; }
vp=$(cnt voiceos public); vh=$(cnt voiceos handson)
sp=$(cnt superintern public); sh_=$(cnt superintern handson)
pub=$((vp + sp)); hands=$((vh + sh_))
if [ "$hands" -gt 0 ]; then
  state "COMPETITIVE_GATE" "PARTIAL" "実機 ${hands} 件（VoiceOS ${vh} / SuperIntern ${sh_}）"
elif [ "$pub" -gt 0 ]; then
  state "COMPETITIVE_GATE" "PUBLIC_ONLY" "公開 ${pub} 件のみ → 画面に写るものだけ比べられる"
else
  state "COMPETITIVE_GATE" "UNDETERMINED" "競合素材 0 件 → 「競合より優れている」とは言えない"
fi

echo
echo "-- いま言ってよいこと --"
if [ "${n:-0}" -lt 3 ]; then
  echo "  「Astra 自身の品質の床は上がった」まで。"
  echo "  「高品質な UI である」は、まだ言えない（採点が ${n}/3 人）。"
  echo "  → 次にやること: docs/ux-benchmark/qualitative/PROTOCOL.md の R01〜R10 を 3 人で。"
elif [ "$hands" -eq 0 ] && [ "$pub" -eq 0 ]; then
  echo "  「高品質な UI である」まで（採点次第）。"
  echo "  「競合より優れている」は、まだ言えない（競合素材が無い）。"
elif [ "$hands" -eq 0 ]; then
  echo "  公開素材で比べてよいのは、画面に写るものだけ（docs/ux-benchmark/EVIDENCE.md）。"
  echo "  「操作が速い」「邪魔にならない」は実機が要る。"
else
  echo "  scripts/ux-benchmark-report.sh の結果を見ること。"
fi
echo
echo "  詳しくは docs/ux-benchmark/CLAIMS.md"
