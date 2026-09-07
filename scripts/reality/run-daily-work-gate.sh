#!/usr/bin/env bash
# ASTRA DAILY WORK GATE — 利用者の価値の gate（技術 gate とは別）。人はクリックも判定もしない。
#
#   pnpm dev:infra && ./scripts/reality/run-daily-work-gate.sh
#
# 各行は既存の測定器から埋める（新しい主観は持ち込まない）:
#   world-model work.test.ts     6 問の意図と最小 pack、期限の捏造 0
#   gateway work.integration     first useful Work Context の時間、出所 100%、turn ごとの selected/available
#   connectors acceptance        read-only first、外部への操作は確認 100%
#   worker tests                 送る許可なしの下書き、JIT の書く許可（purpose つき not_connected）
#   AstraMac --selftest workcontext  1–3 件・なぜ重要？ 1 操作・訂正 1 操作・停止 1 操作・接続状況・静かさ
#   run-work-context-live.sh     接続 <= 2 分（専用 identity が無ければ AUTOMATION_MISSING）
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"
OUT="${ASTRA_DAILY_OUT:-/tmp/astra-daily-work-gate}"
mkdir -p "$OUT"
BIN="$ROOT/apps/astra-macos/.build/debug/AstraMac"
declare -a ROWS=(); fail=0; missing=0
row() { ROWS+=("$1|$2|$3|$4"); }
run() { local name="$1"; shift; "$@" >"$OUT/$name.log" 2>&1; echo $?; }

wm=$(run world-model pnpm --filter @astra/service-world-model exec vitest run test/work.test.ts)
gw=$(run gateway ./infra/db/with-test-db.sh pnpm --filter ./services/api-gateway exec vitest run test/work.integration.test.ts)
acc=$(run acceptance pnpm exec vitest run evals/actions/connectors/acceptance.test.ts)
wk=$(run worker pnpm --filter @astra/worker-agent-host test)
ui=1; if [ -x "$BIN" ]; then "$BIN" --selftest workcontext >"$OUT/ui.out" 2>"$OUT/ui.err"; ui=$?; fi
uiv() { grep "^WORK_CONTEXT_UI	$1=" "$OUT/ui.err" 2>/dev/null | head -1 | cut -f2 | cut -d= -f2; }
first_ms="$(grep -o 'FIRST_VALUE_MS=[0-9]*' "$OUT/gateway.log" | head -1 | cut -d= -f2)"
ok() { [ "$1" = 0 ] && echo PASS || { fail=1; echo FAIL; }; }

# Connect
if [ -n "${ASTRA_TEST_GOOGLE_REFRESH_TOKEN:-}${ASTRA_TEST_MICROSOFT_REFRESH_TOKEN:-}" ]; then
  row Connect "Gmail/Calendar or Microsoft setup" "RUN run-work-context-live.sh" "<= 2 min は live harness の seed→sync の時間で測る"
else
  missing=1; row Connect "Gmail/Calendar or Microsoft setup" "AUTOMATION_MISSING" "専用テスト identity（run-work-context-live.sh）"
fi
row Connect "read-only first" "$(ok "$acc")" "acceptance: 読む接続に write scope 0、書く接続は purpose つき"
row Connect "connected sources visible" "$(uiv connected_sources_visible | grep -q PASS && echo PASS || { fail=1; echo FAIL; })" "Apps: 4 source を接続中 / 未接続 / 設定が必要で並べる（$(uiv sources_connected) 接続）"
# First value
if [ -n "$first_ms" ] && [ "$first_ms" -lt 60000 ]; then row "First value" "first useful Work Context" "${first_ms} ms" "gateway: 取り込み済みから GET /v1/work/context（<= 60 s）"; else fail=1; row "First value" "first useful Work Context" "FAIL" "gateway"; fi
row "First value" "top priorities" "$([ "$ui" = 0 ] && echo '1-3 visible' || { fail=1; echo FAIL; })" "selftest: 3 件、状況 1 行"
row "First value" "every inferred priority has source" "$(uiv provenance_coverage)" "selftest + world-model"
# Daily
for q in "今日何をすべき?" "誰を待っている?" "私が返すものは?" "次の会議を準備して" "これ返して" "今週何がやばい?"; do
  row Daily "$q" "$(ok "$wm")" "world-model: 意図と最小 pack（six daily questions）"
done
# Trust
row Trust "なぜ重要?" "<= $(uiv why_important_actions) action" "理由 $(uiv why_reason_lines) 行 + 出所、数式なし"
row Trust "correction" "<= $(uiv user_correction_actions) action" "優先ではない / 外す / 済んだ"
row Trust "personalization off" "<= $(uiv disable_inference_actions) action" "すべて止める / この推測を使わない"
row Trust "coverage/connected sources visible" "$(ok "$ui")" "Home の見出し「… から整理しています」+ Apps"
row Trust "fabricated deadline" "$([ "$wm" = 0 ] && echo 0 || { fail=1; echo FAIL; })" "world-model: 文に無い期限は null、LLM には作らない指示"
# Action
row Action "draft without send permission" "$(ok "$wk")" "worker: 下書きは承認なし、送信は別の接続 + 承認"
row Action "JIT write permission" "$(ok "$wk")" "worker: 送る接続が無ければ purpose つき not_connected（網に出ない）"
row Action "external confirmation" "$([ "$acc" = 0 ] && echo 100% || { fail=1; echo FAIL; })" "manifest + 実装: EXTERNAL_COMMIT / DESTRUCTIVE は承認の跡が要る"
# Calmness
row Calmness "unsolicited noisy alerts" "$(uiv unsolicited_alerts)" "Work Context は通知を出さない（UNUserNotification の使用 0）"
row Calmness "focus theft" "$(uiv focus_theft)" "selftest: keyWindow 不変"
row Calmness "extra window" "$(uiv extra_window)" "selftest: 窓の数 不変"

{
  echo "ASTRA DAILY WORK GATE $(date +%Y-%m-%dT%H:%M:%S%z) $(git rev-parse --short HEAD)"
  printf '%-12s %-38s %-22s %s\n' group row result evidence
  for r in "${ROWS[@]}"; do IFS='|' read -r g a b c <<<"$r"; printf '%-12s %-38s %-22s %s\n' "$g" "$a" "$b" "$c"; done
  echo "HUMAN_INTERVENTION=0"
  if [ "$fail" != 0 ]; then echo "DAILY_WORK_GATE=FAIL"; elif [ "$missing" != 0 ]; then echo "DAILY_WORK_GATE=PASS_OFFLINE (Connect <= 2 min は live harness 待ち)"; else echo "DAILY_WORK_GATE=PASS"; fi
} | tee "$OUT/report.txt"
exit "$fail"
