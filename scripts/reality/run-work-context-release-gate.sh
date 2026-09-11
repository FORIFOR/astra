#!/usr/bin/env bash
# WORK_CONTEXT_RELEASE_GATE — Work Context 側の最終 gate。Offline / Live / Trust / Automation の 4 段。
#
#   pnpm dev:infra && ./scripts/reality/run-work-context-release-gate.sh
#
# Offline は各 gate スクリプトをそのまま回す。Live は provider ごとの DAILY_WORK_LIVE の結果（無ければ AUTOMATION_MISSING）。
# = PASS は Offline 全 PASS かつ Live 両 PASS のときだけ。PASS を捏造しない。
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"
OUT="${ASTRA_RELEASE_OUT:-/tmp/astra-work-context-release-gate}"; mkdir -p "$OUT"
run() { local name="$1"; shift; "$@" >"$OUT/$name.log" 2>&1; echo $?; }
last() { grep -E "^$1=" "$OUT/$2.log" | tail -1 | cut -d= -f2-; }
wc=$(run work-context ./scripts/reality/run-work-context-gate.sh)
dw=$(run daily ./scripts/reality/run-daily-work-gate.sh)
rb=$(run reply-brief ./scripts/reality/run-reply-brief-gate.sh)
ml=$(run meeting-loop ./scripts/reality/run-meeting-work-loop-gate.sh)
live_status() {
  local provider="$1" mode="$2" name="$3" log="$4" rc
  ASTRA_LIVE_PROVIDER="$provider" ASTRA_LIVE_FAULT_MODE="$mode" bash scripts/reality/run-work-context-live.sh >"$OUT/$log.log" 2>&1
  rc=$?
  if [ "$rc" = 3 ]; then echo AUTOMATION_MISSING
  elif [ "$rc" = 0 ] && grep -q "^$name=PASS$" "$OUT/$log.log"; then echo PASS
  else echo FAIL; fi
}
gl=$(live_status google "" GOOGLE_DAILY_WORK_LIVE live-google)
ml_live=$(live_status microsoft "" MICROSOFT_DAILY_WORK_LIVE live-microsoft)
gr=AUTOMATION_MISSING; mr=AUTOMATION_MISSING
if [ "$gl" = PASS ]; then gr=$(live_status google send-response-loss GOOGLE_CONNECTOR_RESPONSE_LOSS_LIVE recovery-google); fi
if [ "$ml_live" = PASS ]; then mr=$(live_status microsoft send-response-loss MICROSOFT_CONNECTOR_RESPONSE_LOSS_LIVE recovery-microsoft); fi
off_ok=1; for rc in "$wc" "$dw" "$rb" "$ml"; do [ "$rc" = 0 ] || off_ok=0; done
live_ok=0; [ "$gl" = PASS ] && [ "$ml_live" = PASS ] && [ "$gr" = PASS ] && [ "$mr" = PASS ] && live_ok=1
{
  echo "WORK_CONTEXT_RELEASE_GATE $(date +%Y-%m-%dT%H:%M:%S%z) $(git rev-parse --short HEAD)"
  echo
  echo "Offline"
  printf '  %-30s %s\n' WORK_CONTEXT_GATE "$(last WORK_CONTEXT_GATE work-context)"
  printf '  %-30s %s\n' DAILY_WORK_GATE "$(last DAILY_WORK_GATE daily)"
  printf '  %-30s %s\n' REPLY_IN_CONTEXT_GATE "$(last REPLY_IN_CONTEXT_GATE reply-brief)"
  printf '  %-30s %s\n' MEETING_BRIEF_GATE "$(last MEETING_BRIEF_GATE reply-brief)"
  printf '  %-30s %s\n' MEETING_WORK_LOOP_GATE "$(last MEETING_WORK_LOOP_GATE meeting-loop)"
  printf '  %-30s %s\n' OUTLOOK_REPLY_GATE "$(last OUTLOOK_REPLY_GATE reply-brief)"
  echo
  echo "Live"
  printf '  %-30s %s\n' "Google sync / Gmail real reply / Work Graph / Home / brief with synthetic meeting input" "$gl"
  printf '  %-30s %s\n' "Microsoft sync / Outlook real reply / Work Graph / Home / brief with synthetic meeting input" "$ml_live"
  echo "  Real Meet ingestion is not measured here; REAL_MEETING_GATE is independently required."
  echo
  echo "Live recovery (accepted send / lost response / no retry / exact receipt)"
  printf '  %-30s %s\n' Google "$gr"
  printf '  %-30s %s\n' Microsoft "$mr"
  echo
  echo "Trust"
  printf '  %-30s %s\n' "read-only first" "$(grep -E '^google_read_only_first ' "$OUT/work-context.log" | awk -F'|' '{gsub(/ /,"",$2); print $2}')"
  printf '  %-30s %s\n' "JIT write permission" "$(grep -E '^REPLY +JIT send permission' "$OUT/reply-brief.log" | awk '{print $5}')"
  printf '  %-30s %s\n' "external confirmation" "$(grep -E '^external_action_confirmation ' "$OUT/work-context.log" | awk -F'|' '{gsub(/ /,"",$2); print $2}')"
  printf '  %-30s %s\n' "source provenance" "$(grep -E '^provenance_coverage ' "$OUT/work-context.log" | awk -F'|' '{gsub(/ /,"",$2); print $2}')"
  printf '  %-30s %s\n' "fabricated deadline/item" "$(grep -E 'fabricated deadline' "$OUT/daily.log" | awk '{print $4}') / $(grep -E '^BRIEF +fabricated issue' "$OUT/reply-brief.log" | awk '{print $4}')"
  printf '  %-30s %s\n' "cross-project contamination" "$(grep -E '^BRIEF +cross-project contamination' "$OUT/reply-brief.log" | awk '{print $4}')"
  echo
  echo "Automation"
  printf '  %-30s %s\n' "live gate human intervention" "0 (once identities are provisioned; none is on this Mac)"
  echo
  if [ "$off_ok" = 1 ] && [ "$live_ok" = 1 ]; then echo "WORK_CONTEXT_RELEASE_GATE=PASS"
  elif [ "$off_ok" = 1 ]; then echo "WORK_CONTEXT_RELEASE_GATE=NOT_YET (offline all PASS; live = $gl / $ml_live; recovery = $gr / $mr)"
  else echo "WORK_CONTEXT_RELEASE_GATE=FAIL (offline)"; fi
} | tee "$OUT/report.txt"
[ "$off_ok" = 1 ] && [ "$live_ok" = 1 ]
