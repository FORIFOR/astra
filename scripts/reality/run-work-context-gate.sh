#!/usr/bin/env bash
# WORK_CONTEXT_GATE — Work Context / Personalization Layer の完成検査。人はクリックも判定もしない。
#
#   pnpm dev:infra && ./scripts/reality/run-work-context-gate.sh
#
# 各行は**測定器**の結果から埋める。測定器が無い行は AUTOMATION_MISSING と言う（NOT_MEASURED は禁止）。
#
#   測定器                                              行
#   services/world-model test/work.test.ts              deterministic scoring / provenance / injection relevance / rule stand-in
#   services/world-model test/work.db.test.ts (PG)      storage / tenant isolation / corrections / personalization
#   services/connectors test/{microsoft,normalize}      read-only Graph / normalization (excerpt <= 500, semantic null)
#   workers/agent-host test/{work-sync,llm-steps}       device sync (no bodies, cursor, LLM classification, one failure)
#   services/api-gateway test/work.integration (PG)     HTTP surface + chat-lane injection (real routes, real DB)
#   evals/actions/connectors/tool-coverage              every declared tool has somewhere to run
#   packages/plugin-sdk test/manifest                   external actions declare confirmation
#   AstraMac --selftest workcontext                     Home card: provenance 100%, 1-action correction / disable, no big cards
#   keychain (security)                                 connectors connected on THIS Mac (live) — 無ければ NOT_CONNECTED
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"
OUT="${ASTRA_WC_OUT:-/tmp/astra-work-context-gate}"
mkdir -p "$OUT"
BIN="$ROOT/apps/astra-macos/.build/debug/AstraMac"

declare -a ROWS=()
row() { ROWS+=("$1|$2|$3"); }
fail=0

run_vitest() { # name, dir-or-filter, files...
  local name="$1"; shift
  local log="$OUT/$name.log"
  "$@" >"$log" 2>&1
  local rc=$?
  local summary
  summary="$(grep -E '^\s*Tests ' "$log" | tail -1 | sed 's/^ *//')"
  echo "$rc|$summary"
}

# ---------------------------------------------------------------- 1. pure engine
r="$(run_vitest world-pure pnpm --filter @astra/service-world-model exec vitest run test/work.test.ts)"
rc="${r%%|*}"; s="${r#*|}"
[ "$rc" = 0 ] || fail=1
row "deterministic_scoring" "$([ "$rc" = 0 ] && echo PASS || echo FAIL)" "world-model work.test.ts ($s)"
row "provenance_coverage" "$([ "$rc" = 0 ] && echo 100% || echo FAIL)" "同上（出所の無い出力は 1 件も無い）"
row "irrelevant_injection" "$([ "$rc" = 0 ] && echo 'below threshold' || echo FAIL)" "同上（関連する案件だけ、<= 3 件 / 1200 字）"
row "task_waiting_deadline_inference" "$([ "$rc" = 0 ] && echo PASS || echo FAIL)" "同上（owed / waiting / extractDeadline）"
row "project_clustering" "$([ "$rc" = 0 ] && echo PASS || echo FAIL)" "同上（clusterProjects: 明示 → thread → Jaccard）"
# CONTEXT_MINIMIZATION_GATE（問い → 意図 → 候補 → 閾値 → 最小の pack、turn ごとに selected / available）
row "cm_scheduling_query_relevant" "$([ "$rc" = 0 ] && echo PASS || echo FAIL)" "「今日何を優先」→ 関連する案件 <= 3、selected <= available"
row "cm_unrelated_coding_query" "$([ "$rc" = 0 ] && echo 0 || echo FAIL)" "「この Swift コード直して」→ 0 件（intent none）"
row "cm_email_reply_target_only" "$([ "$rc" = 0 ] && echo PASS || echo FAIL)" "「MTI に返信を書いて」→ 相手の案件だけ、名指しの無い「返信して」→ 0"
row "cm_meeting_prep_pack" "$([ "$rc" = 0 ] && echo PASS || echo FAIL)" "「MOPITA 定例の準備」→ 案件 + 相手 + 開いている件"

# ---------------------------------------------------------------- 2. connectors (read-only, normalization)
r="$(run_vitest connectors pnpm --filter @astra/service-connectors test)"
rc="${r%%|*}"; s="${r#*|}"
[ "$rc" = 0 ] || fail=1
row "connectors_read_only_contract" "$([ "$rc" = 0 ] && echo PASS || echo FAIL)" "connectors ($s): \$select に body 無し、scope 無しは網に出ない"
row "normalization_excerpt_only" "$([ "$rc" = 0 ] && echo PASS || echo FAIL)" "normalize: body_excerpt <= 500 / provenance <= 200 / semantic null"

# read-only default: Work Context の plugin は *.read だけ
ro=1
for p in plugins/builtin/outlook/plugin.yaml plugins/builtin/microsoft-todo/plugin.yaml; do
  if python3 - "$p" <<'PY'; then :; else ro=0; fi
import sys, yaml
m = yaml.safe_load(open(sys.argv[1]))
# 読む接続（Work Context が使うもの）は .read だけ。書く許可は別の接続（purpose 必須）にだけあってよい。
conns = m.get("connectors", [])
read = [c for c in conns if all(g.endswith(".read") for g in c.get("grants", []))]
bad = [] if read else ["no read-only connection"]
for c in conns:
    if any(not g.endswith(".read") for g in c.get("grants", [])) and not c.get("purpose"):
        bad.append(f"{c['id']}: write connection without purpose")
for t in m.get("tools", []):
    if t.get("risk") != "READ" and not t.get("requires_confirmation"):
        bad.append(f"{t['id']}: write tool without confirmation")
sys.exit(1 if bad else 0)
PY
done
row "read_only_default" "$([ "$ro" = 1 ] && echo PASS || echo FAIL)" "outlook / microsoft-todo: 読む接続は *.read だけ、書く接続は purpose つき、書く tool は確認つき"
[ "$ro" = 1 ] || fail=1

# read-only first (Google): 読む接続に書く scope が無く、書く許可は理由つきの別の接続にある
r="$(run_vitest connectors-acceptance pnpm exec vitest run evals/actions/connectors/acceptance.test.ts)"
rc="${r%%|*}"; s="${r#*|}"; [ "$rc" = 0 ] || fail=1
row "google_read_only_first" "$([ "$rc" = 0 ] && echo PASS || echo FAIL)" "connectors acceptance ($s): 読む接続の write scope 0、書く許可は -actions 接続に purpose つき、tool → 接続の結び"
row "workcontext_gmail_write_scopes" "$([ "$rc" = 0 ] && echo 0 || echo FAIL)" "manifest gmail/gmail: gmail.readonly だけ"
row "workcontext_calendar_write_scopes" "$([ "$rc" = 0 ] && echo 0 || echo FAIL)" "manifest calendar/google-calendar: calendar.readonly だけ"

# ---------------------------------------------------------------- 3. device worker
r="$(run_vitest worker pnpm --filter @astra/worker-agent-host test)"
rc="${r%%|*}"; s="${r#*|}"
[ "$rc" = 0 ] || fail=1
row "raw_full_mailbox_to_llm" "$([ "$rc" = 0 ] && echo 0 || echo FAIL)" "work-sync: format=full を要求しない、LLM には件名+抜粋だけ"
row "send_scope_requested_before_action" "$([ "$rc" = 0 ] && echo 0 || echo FAIL)" "worker: 読む tool と同期は読む接続の鍵だけ、送る tool は送る接続が無ければ purpose つきで not_connected（網に出ない）"
row "purpose_first_before_escalation" "$([ "$rc" = 0 ] && echo PASS || echo FAIL)" "not_connected の文に接続名と purpose、manifest の書く接続は purpose 必須（契約の refine）"
row "llm_semantic_extraction" "$([ "$rc" = 0 ] && echo PASS || echo FAIL)" "llm.classify_email（期限を作らない指示、道具 0）、読めない返事は捨てる"
row "one_source_failure_isolated" "$([ "$rc" = 0 ] && echo PASS || echo FAIL)" "1 つの source が落ちても他は進み cursor は進めない"

# ---------------------------------------------------------------- 4. declared == enforced
r="$(run_vitest tool-coverage pnpm exec vitest run evals/actions/connectors/tool-coverage.test.ts)"
rc="${r%%|*}"; [ "$rc" = 0 ] || fail=1
row "declared_tools_have_runner" "$([ "$rc" = 0 ] && echo PASS || echo FAIL)" "tool-coverage"
r="$(run_vitest manifest pnpm --filter @astra/plugin-sdk test)"
rc="${r%%|*}"; [ "$rc" = 0 ] || fail=1
row "external_action_confirmation" "$([ "$rc" = 0 ] && echo 100% || echo FAIL)" "manifest: EXTERNAL_COMMIT / DESTRUCTIVE は requires_confirmation"

# ---------------------------------------------------------------- 5. storage + HTTP + injection (real DB)
if pg_isready -h "${ASTRA_TEST_PGHOST:-localhost}" -p "${ASTRA_TEST_PGPORT:-5433}" >/dev/null 2>&1; then
  r="$(run_vitest world-db ./infra/db/with-test-db.sh pnpm --filter @astra/service-world-model exec vitest run test/work.db.test.ts)"
  rc="${r%%|*}"; s="${r#*|}"; [ "$rc" = 0 ] || fail=1
  row "storage_tenant_isolation" "$([ "$rc" = 0 ] && echo PASS || echo FAIL)" "work.db.test.ts ($s)"
  r="$(run_vitest gateway ./infra/db/with-test-db.sh pnpm --filter ./services/api-gateway exec vitest run test/work.integration.test.ts)"
  rc="${r%%|*}"; s="${r#*|}"; [ "$rc" = 0 ] || fail=1
  row "http_surface_and_chat_injection" "$([ "$rc" = 0 ] && echo PASS || echo FAIL)" "gateway work.integration ($s): POST artifacts → GET context → chat lane <work_context>"
  row "cross_source_entity_resolution" "$([ "$rc" = 0 ] && echo PASS || echo FAIL)" "同上（Astra task + meeting + gmail が同じ案件に）"
  row "cm_stats_recorded_per_turn" "$([ "$rc" = 0 ] && echo PASS || echo FAIL)" "同上（task.input.context_meta に intent / selected / available、log にも）"
  row "persistent_sync_cursor" "$([ "$rc" = 0 ] && echo PASS || echo FAIL)" "work.db + gateway: cursor は upsert と同じ tx でだけ進む、途中 batch は前の cursor、失敗は理由だけ"
else
  fail=1
  row "storage_tenant_isolation" "AUTOMATION_MISSING" "PG 5433 が無い（pnpm dev:infra）"
  row "http_surface_and_chat_injection" "AUTOMATION_MISSING" "同上"
  row "cross_source_entity_resolution" "AUTOMATION_MISSING" "同上"
fi

# ---------------------------------------------------------------- 6. Home UI
if [ -x "$BIN" ]; then
  "$BIN" --selftest workcontext >"$OUT/ui.out" 2>"$OUT/ui.err"
  rc=$?
  [ "$rc" = 0 ] || fail=1
  ui() { grep "^WORK_CONTEXT_UI	$1=" "$OUT/ui.err" | head -1 | cut -f2 | cut -d= -f2; }
  row "work_context_visible" "$([ "$rc" = 0 ] && echo PASS || echo FAIL)" "$(head -1 "$OUT/ui.out")"
  row "personalization_visible" "$([ "$rc" = 0 ] && echo PASS || echo FAIL)" "inspector（観測 / 推測 / 確認済み、[編集] から）"
  row "ui_provenance_coverage" "$(ui provenance_coverage)" "行ごとに [出所を見る]"
  row "user_correction_actions" "<= $(ui user_correction_actions)" "優先ではない / 外す / 済んだ"
  row "disable_inference_actions" "<= $(ui disable_inference_actions)" "推測を使わない（全体）/ この推測を使わない（1 件）"
  row "no_big_cards" "$(ui no_big_cards)" "card height $(ui card_height_pt)pt < 660"
else
  fail=1
  row "work_context_visible" "AUTOMATION_MISSING" "debug 実行体が無い（swift build --package-path apps/astra-macos）"
fi

# ---------------------------------------------------------------- 7. live connectors on THIS Mac
live=""
for key in "com.astra.gmail/gmail" "com.astra.google-calendar/google-calendar" "com.astra.outlook/outlook" "com.astra.microsoft-todo/microsoft-todo"; do
  if security find-generic-password -a "$USER" -s "com.astra.connector.$key" >/dev/null 2>&1; then live="$live ${key%%/*}"; fi
done
if [ -n "$live" ]; then
  row "connectors_connected" "CONNECTED" "$live"
else
  # 接続は本人の OAuth 同意（client id + 同意画面）が要る。無いものを繋いだことにしない。
  row "connectors_connected" "NOT_CONNECTED" "この Mac に connector のトークンが無い（ASTRA_OAUTH_*_CLIENT_ID 未設定）。契約試験（fixture）で代替、live は AUTOMATION_MISSING"
fi

# ---------------------------------------------------------------- report
{
  echo "WORK_CONTEXT_GATE $(date +%Y-%m-%dT%H:%M:%S%z) $(git rev-parse --short HEAD)"
  printf '%-36s | %-18s | %s\n' "row" "result" "evidence"
  for r in "${ROWS[@]}"; do
    IFS='|' read -r a b c <<<"$r"
    printf '%-36s | %-18s | %s\n' "$a" "$b" "$c"
  done
  echo "HUMAN_INTERVENTION=0"
  # 測った行が全部通っても、この Mac で実サービスに繋いでいなければ PASS とは言わない（PASS_OFFLINE）。
  if [ "$fail" != 0 ]; then echo "WORK_CONTEXT_GATE=FAIL"
  elif [ -n "$live" ]; then echo "WORK_CONTEXT_GATE=PASS"
  else echo "WORK_CONTEXT_GATE=PASS_OFFLINE"; fi
  # 2 段目: 実サービスに繋いだ無人検証（scripts/reality/run-work-context-live.sh）。
  # 専用テスト identity の refresh token が事前に無ければ AUTOMATION_MISSING と言う（人に OAuth を頼まない）。
  g="AUTOMATION_MISSING"; m="AUTOMATION_MISSING"
  [ -n "${ASTRA_TEST_GOOGLE_REFRESH_TOKEN:-}" ] && g="RUN (ASTRA_LIVE_PROVIDER=google scripts/reality/run-work-context-live.sh)"
  [ -n "${ASTRA_TEST_MS_REFRESH_TOKEN:-}${ASTRA_TEST_MICROSOFT_REFRESH_TOKEN:-}" ] && m="RUN (ASTRA_LIVE_PROVIDER=microsoft scripts/reality/run-work-context-live.sh)"
  echo "GOOGLE_DAILY_WORK_LIVE=$g"
  echo "MICROSOFT_DAILY_WORK_LIVE=$m"
  if [[ "$g" == RUN* && "$m" == RUN* ]]; then
    echo "WORK_CONTEXT_LIVE_GATE=RUN both providers above; PASS only when both report PASS"
  else
    echo "WORK_CONTEXT_LIVE_GATE=AUTOMATION_MISSING (pre-provisioned test identities: ASTRA_TEST_GOOGLE_* / ASTRA_TEST_MS_* refresh tokens + client ids, sinks optional; then both DAILY_WORK_LIVE runs are unattended)"
  fi
} | tee "$OUT/report.txt"
exit "$fail"
