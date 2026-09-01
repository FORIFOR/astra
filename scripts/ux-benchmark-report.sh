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
competitor_have=0

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

  v="未取得"; s="未取得"
  [ -n "$(ls "$BENCH/voiceos/${j}"* 2>/dev/null)" ] && { v="取得済"; competitor_have=$((competitor_have+1)); }
  [ -n "$(ls "$BENCH/superintern/${j}"* 2>/dev/null)" ] && { s="取得済"; competitor_have=$((competitor_have+1)); }

  printf "%-6s %-26s %-10s %-10s %-10s\n" "$j" "$(echo "$title" | cut -c1-24)" "$a" "$v" "$s"
done

echo
echo "Astra: ${astra_measured}/10 計測・${astra_success} 完遂"
echo "競合:  ${competitor_have} 件取得"
echo

# ---- SUPERIOR_GATE ----
echo "== SUPERIOR_GATE =="
if [ "$competitor_have" -eq 0 ]; then
  cat <<'EOF'
  判定できない。

  競合（VoiceOS / SuperIntern）の計測が 1 件も無い。
  「Astra のほうが優れている」は競合と比べて初めて言えることなので、
  ここで「合格」と出すのは、確かめていないことを確かめたと言うことになる。

  必要なもの:
    docs/ux-benchmark/voiceos/      V01… + metadata.yaml
    docs/ux-benchmark/superintern/  S01… + metadata.yaml
  静止画だけでなく、状態が変わる Journey は .mp4 も。
  アシスタントはこの 2 製品を入手できないので、ここは人が撮る。

SUPERIOR_GATE=UNDETERMINED（競合未取得）
EOF
  exit 0
fi

echo "  競合データがあるので比較する（未実装：取得後に書く）"
echo "SUPERIOR_GATE=PARTIAL"
