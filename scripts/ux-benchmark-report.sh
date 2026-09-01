#!/usr/bin/env bash
# Competitive UX Benchmark の集計と SUPERIOR_GATE。
#
# **競合の数字が無いまま「勝った」と言わない。** ここが最も大事な性質で、
# 取得できていない Journey を 0 として数えると、やっていないことが勝ちに化ける。
# 未取得は未取得として出し、SUPERIOR_GATE は通さない。
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BENCH="$ROOT/docs/ux-benchmark"
JOURNEYS="J01 J02 J03 J04 J05 J06 J07 J08 J09 J10"

echo "== Competitive UX Benchmark =="
echo

printf "%-6s %-26s %-10s %-10s %-10s\n" "ID" "課題" "Astra" "VoiceOS" "SuperIntern"
printf "%-6s %-26s %-10s %-10s %-10s\n" "----" "------------------------" "--------" "--------" "-----------"

astra_measured=0; astra_success=0
competitor_have=0; public_only=0

# その製品のその Journey に、どの格の素材があるか。
#   実機     handson/ にある → 速度・焦点・成功率まで比べてよい
#   公開のみ public/ にある  → 画面に写るものだけ。速度は出せない
#   未取得   何も無い
evidence() {
  local prod="$1" j="$2"
  if [ -n "$(ls "$BENCH/$prod/handson/${j}"* 2>/dev/null)" ]; then echo "実機"
  elif [ -n "$(ls "$BENCH/$prod/public/${j}"* 2>/dev/null)" ]; then echo "公開のみ"
  else echo "未取得"; fi
}

for j in $JOURNEYS; do
  title="$(sed -n '1s/^# *//p' "$BENCH/journeys/${j}-"*.md 2>/dev/null | head -1)"
  title="${title:-（定義なし）}"
  title="${title#* — }"

  a="未計測"
  if [ -f "$BENCH/astra/$j/result.json" ]; then
    ok="$(python3 -c "import json;print(json.load(open('$BENCH/astra/$j/result.json'))['success'])" 2>/dev/null)"
    ms="$(python3 -c "import json;print(json.load(open('$BENCH/astra/$j/result.json'))['totalMs'])" 2>/dev/null)"
    astra_measured=$((astra_measured+1))
    if [ "$ok" = "True" ]; then a="${ms}ms"; astra_success=$((astra_success+1)); else a="失敗"; fi
  fi

  # 公開素材と実機素材を**分けて数える**。公開素材からは速度・焦点・成功率を
  # 出せないので、それを「取得済」と同じ扱いにすると、公式サイトの 1 枚が
  # 実測に化ける（docs/ux-benchmark/EVIDENCE.md）。
  v="$(evidence voiceos "$j")"; s="$(evidence superintern "$j")"
  [ "$v" = "実機" ] && competitor_have=$((competitor_have+1))
  [ "$s" = "実機" ] && competitor_have=$((competitor_have+1))
  [ "$v" = "公開のみ" ] && public_only=$((public_only+1))
  [ "$s" = "公開のみ" ] && public_only=$((public_only+1))

  printf "%-6s %-26s %-10s %-10s %-10s\n" "$j" "$(echo "$title" | cut -c1-24)" "$a" "$v" "$s"
done

echo
echo "Astra: ${astra_measured}/10 計測・${astra_success} 完遂"
echo "競合:  実機 ${competitor_have} 件 / 公開のみ ${public_only} 件"
if [ "$public_only" -gt 0 ]; then
  echo
  echo "  公開素材からは **速度・焦点を奪ったか・完遂したか・操作数・初回成功率** を出さない。"
  echo "  公式素材は最良の撮り直しなので、そこから所要時間を読むと必ず有利に出る。"
  echo "  比べてよいのは、情報階層・Density・Surface 設計・画面占有率・状態の見え方・"
  echo "  Action visibility・空状態・Confirmation・Canvas 構成（docs/ux-benchmark/EVIDENCE.md）。"
fi
echo

# ---- SUPERIOR_GATE ----
echo "== SUPERIOR_GATE =="
if [ "$competitor_have" -eq 0 ]; then
  cat <<'EOF'
  判定できない。

  競合（VoiceOS / SuperIntern）の計測が 1 件も無い。
  「Astra のほうが優れている」は競合と比べて初めて言えることなので、
  ここで「合格」と出すのは、確かめていないことを確かめたと言うことになる。

  必要なもの（**実機**。公開素材ではこのゲートは通らない）:
    docs/ux-benchmark/voiceos/handson/      J01… + metadata.yaml
    docs/ux-benchmark/superintern/handson/  J01… + metadata.yaml
  静止画だけでなく、状態が変わる Journey は .mp4 も。
  アシスタントはこの 2 製品を入手できないので、ここは人が撮る。

  公開素材だけで先に進める分（Level 1）は別にある:
    docs/ux-benchmark/<製品>/public/ + sources.md
  こちらは画面に写るものだけを比べる。速度・焦点・成功率は出さない。

SUPERIOR_GATE=UNDETERMINED（競合未取得）
EOF
  exit 0
fi

echo "  競合データがあるので比較する（未実装：取得後に書く）"
echo "SUPERIOR_GATE=PARTIAL"
