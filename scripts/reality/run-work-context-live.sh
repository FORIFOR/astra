#!/usr/bin/env bash
# DAILY_WORK_LIVE — 実サービスに繋いだ Work Context の無人検証（閉ループ）。provider ごとに別々に回す。
#
#   pnpm dev:infra && ASTRA_LIVE_PROVIDER=google    ./scripts/reality/run-work-context-live.sh   → GOOGLE_DAILY_WORK_LIVE
#   pnpm dev:infra && ASTRA_LIVE_PROVIDER=microsoft ./scripts/reality/run-work-context-live.sh   → MICROSOFT_DAILY_WORK_LIVE
#
#   credentials → fixture seed → 実 connector 同期 → Work Graph → Home → 「これ返して」→ 実 draft（端末の LLM）
#   → 承認（harness が押す）→ sink へ実送信 → 会議 1 の結論を publisher の形で投入 → 次の予定 → Meeting Brief → 掃除
#
# 人は OAuth を押さない（人手 0）。専用のテスト identity を**事前に**用意し、その refresh token を
# 環境変数で渡す。本人のアカウントも login keychain も触らない（トークンはこの実行だけのファイル）。
#
#   ASTRA_TEST_GOOGLE_CLIENT_ID / ASTRA_TEST_GOOGLE_REFRESH_TOKEN   [ASTRA_TEST_GMAIL_SINK]
#       Google Workspace のテスト identity。scope: gmail.insert gmail.modify calendar.events
#   ASTRA_TEST_MS_CLIENT_ID / ASTRA_TEST_MS_REFRESH_TOKEN               [ASTRA_TEST_OUTLOOK_SINK]
#       Microsoft tenant のテスト identity。scope: Mail.ReadWrite Calendars.ReadWrite User.Read offline_access
#   READ / WRITE_REFRESH_TOKEN もそれぞれ必須。scopeは live-oauth.ts の LIVE_SCOPES を参照。
#   Claude Code CLI（端末の LLM。返信案を書く）。sink は identity 自身のみ。
#
# 流れ: preflight → 使い捨て DB + gateway → 固定 fixture を投入（Mail A/B・顧客定例・タスク）→
#       端末 worker が読む接続だけで同期 → 期待した Work Graph（案件・期限・待ち・会議・pressure HIGH）を assert → 掃除。
# 揃っていない前提は AUTOMATION_MISSING と名指しする（PASS を捏造しない。人を呼ばない）。
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"
export ASTRA_LLM_CLI="${ASTRA_LLM_CLI:-claude_code}"
case "$ASTRA_LLM_CLI" in
  codex) LLM_COMMAND="${ASTRA_CODEX_PATH:-codex}" ;;
  claude_code) LLM_COMMAND="${ASTRA_CLAUDE_CODE_PATH:-claude}" ;;
  api|local) LLM_COMMAND="" ;;
  *) echo 'FAIL: ASTRA_LLM_CLI must be codex, claude_code, api, local, or none'; exit 1 ;;
esac

PROVIDER="${ASTRA_LIVE_PROVIDER:-google}"
PORT="${ASTRA_LIVE_PORT:-3399}"
PGHOST="${ASTRA_TEST_PGHOST:-localhost}"
PGPORT="${ASTRA_TEST_PGPORT:-5433}"
PGSUPER="${ASTRA_TEST_PGUSER:-astra}"
export PGPASSWORD="${ASTRA_TEST_PGPASSWORD:-astra}"
DB="astra_wclive_$$"
ADMIN_URL="postgres://${PGSUPER}:${PGPASSWORD}@${PGHOST}:${PGPORT}/${DB}?sslmode=disable"
STORE=""
OUT="${ASTRA_LIVE_OUT:-/tmp/astra-work-context-live}"
BASE="http://127.0.0.1:${PORT}"
EMAIL="work-context-live-$$@astra.local"
NONCE="WC$(date +%s | tail -c 6)"
mkdir -p "$OUT"
export ASTRA_LIVE_FAULT_NONCE="$NONCE" ASTRA_LIVE_FAULT_LOG="$OUT/fault-$PROVIDER-$NONCE.json"

# ---- 1. preflight（この provider に要るものだけ）
NAME="$([ "$PROVIDER" = microsoft ] && echo MICROSOFT_DAILY_WORK_LIVE || echo GOOGLE_DAILY_WORK_LIVE)"
if [ "${ASTRA_LIVE_FAULT_MODE:-}" = send-response-loss ]; then NAME="$(echo "$PROVIDER" | tr '[:lower:]' '[:upper:]')_CONNECTOR_RESPONSE_LOSS_LIVE"; fi
if [ "${ASTRA_LIVE_READ_DIAGNOSTIC:-}" = 1 ]; then NAME="$(echo "$PROVIDER" | tr '[:lower:]' '[:upper:]')_READ_DIAGNOSTIC"; fi
have=(); missing=()
if [ "$PROVIDER" = microsoft ]; then
  [[ -n "${ASTRA_TEST_MS_CLIENT_ID:-}${ASTRA_TEST_MICROSOFT_CLIENT_ID:-}" && -n "${ASTRA_TEST_MS_REFRESH_TOKEN:-}${ASTRA_TEST_MICROSOFT_REFRESH_TOKEN:-}" ]] && have+=("microsoft test identity") || missing+=("Microsoft tenant test identity (ASTRA_TEST_MS_CLIENT_ID + ASTRA_TEST_MS_REFRESH_TOKEN; scopes Mail.ReadWrite/Calendars.ReadWrite/User.Read/offline_access)")
else
  [[ -n "${ASTRA_TEST_GOOGLE_CLIENT_ID:-}" && -n "${ASTRA_TEST_GOOGLE_REFRESH_TOKEN:-}" ]] && have+=("google test identity") || missing+=("Google Workspace test identity (ASTRA_TEST_GOOGLE_CLIENT_ID + ASTRA_TEST_GOOGLE_REFRESH_TOKEN; scopes gmail.insert/gmail.modify/calendar.events)")
fi
for grant in READ WRITE; do
  if [ "$PROVIDER" = microsoft ]; then
    key="ASTRA_TEST_MS_${grant}_REFRESH_TOKEN"; alias="ASTRA_TEST_MICROSOFT_${grant}_REFRESH_TOKEN"
    [[ -n "${!key:-}${!alias:-}" ]] || missing+=("dedicated ${grant} grant ($key)")
  else
    key="ASTRA_TEST_GOOGLE_${grant}_REFRESH_TOKEN"
    [[ -n "${!key:-}" ]] || missing+=("dedicated ${grant} grant ($key)")
  fi
done
pg_isready -h "$PGHOST" -p "$PGPORT" >/dev/null 2>&1 && have+=("postgres:$PGPORT") || missing+=("postgres at $PGHOST:$PGPORT (pnpm dev:infra)")
command -v dbmate >/dev/null 2>&1 && have+=("dbmate") || missing+=("dbmate")
if [ -n "$LLM_COMMAND" ]; then
  command -v "$LLM_COMMAND" >/dev/null 2>&1 && have+=("$ASTRA_LLM_CLI cli") || missing+=("$LLM_COMMAND on PATH (device LLM for the draft)")
elif [ "$ASTRA_LLM_CLI" = local ]; then
  curl -fsS --max-time 3 "${ASTRA_LOCAL_LLM_URL:-http://127.0.0.1:11434/v1}/models" >/dev/null 2>&1 && have+=("local LLM endpoint") || missing+=("local LLM endpoint (ASTRA_LOCAL_LLM_URL)")
elif [ "$ASTRA_LLM_CLI" = api ]; then
  [[ -n "${ASTRA_OPENAI_API_URL:-}${ASTRA_GEMINI_API_URL:-}${ASTRA_ANTHROPIC_API_URL:-}" ]] && have+=("API LLM endpoint") || missing+=("API LLM endpoint")
fi
echo "$NAME have=[${have[*]:-}]"
if [[ ${#missing[@]} -gt 0 ]]; then
  printf '%s=AUTOMATION_MISSING %s\n' "$NAME" "$(IFS=';'; echo "${missing[*]}")"
  exit 3
fi

STORE="$(mktemp -d)"
GATEWAY_PID=""; HOST_PID=""; WORKER_PID=""
cleanup() {
  local rc=$?
  trap - EXIT
  local cleanup_failed=0
  for pid in "$HOST_PID" "$WORKER_PID" "$GATEWAY_PID"; do [ -n "$pid" ] && { python3 "$ROOT/scripts/reality/stop-test-process.py" "$pid" 2>/dev/null || true; wait "$pid" 2>/dev/null || true; }; done
  if [ -f "$STORE/seeded.json" ]; then
    ASTRA_LIVE_PROVIDER="$PROVIDER" ASTRA_SECRET_STORE_FILE="$STORE/secrets.json" pnpm exec tsx workers/agent-host/src/live-seed.ts "$NONCE" --cleanup "$STORE/seeded.json" >> "$STORE/seed.log" 2>&1 || cleanup_failed=1
  fi
  dbmate --url "$ADMIN_URL" --migrations-dir "$ROOT/infra/db/migrations" --no-dump-schema drop >/dev/null 2>&1 || cleanup_failed=1
  # bootstrap.sql のロールはクラスタ共通。別DBや別の検証も使用するため、
  # このrunの一時DBを片付ける際に削除してはいけない。
  cp "$STORE"/*.log "$OUT/" 2>/dev/null || true
  if [ "$cleanup_failed" != 0 ]; then
    [ ! -f "$STORE/seeded.json" ] || cp "$STORE/seeded.json" "$OUT/seeded-cleanup-pending-$PROVIDER.json"
    echo "$NAME=FAIL cleanup incomplete; fixture IDs retained in $OUT" >&2
    rc=1
  elif [ "$rc" = 0 ]; then
    echo "$NAME=PASS"
  fi
  rm -rf "$STORE"   # トークンのファイルはここで消える
  exit $rc
}
trap cleanup EXIT
fail() { echo "$NAME=FAIL $1" >&2; for f in host worker gateway seed; do [ -f "$STORE/$f.log" ] && { echo "--- $f.log ---" >&2; tail -25 "$STORE/$f.log" >&2; }; done; exit 1; }
json() { python3 -c "import json,sys;d=json.load(sys.stdin);print($1)"; }

# ---- 2. 使い捨て DB + gateway
dbmate --url "$ADMIN_URL" --migrations-dir "$ROOT/infra/db/migrations" --no-dump-schema up >/dev/null || fail "dbmate up"
psql "$ADMIN_URL" -X -q -v ON_ERROR_STOP=1 -f "$ROOT/infra/db/bootstrap.sql" >/dev/null || fail "bootstrap.sql"
export ASTRA_ENV=development ASTRA_API_PORT="$PORT" ASTRA_LOG_LEVEL=info
export DATABASE_URL="postgres://astra_app:astra_app@${PGHOST}:${PGPORT}/${DB}?sslmode=disable"
export ASTRA_DB_IDENTITY_URL="postgres://astra_identity:astra_identity@${PGHOST}:${PGPORT}/${DB}?sslmode=disable"
export REDIS_URL="${REDIS_URL:-redis://localhost:6380}" TEMPORAL_ADDRESS="${TEMPORAL_ADDRESS:-localhost:7233}"
export ASTRA_OBJECT_STORE_ROOT="$STORE" ASTRA_RECORDING_ROOT="$STORE/recordings" ASTRA_BUILTIN_PLUGINS_DIR="$ROOT/plugins/builtin"
export ASTRA_TASK_QUEUE="astra.task.wclive.$$"
python3 "$ROOT/scripts/reality/without-test-credentials.py" pnpm exec tsx workers/task-worker/src/worker-main.ts > "$STORE/worker.log" 2>&1 &
WORKER_PID=$!
python3 "$ROOT/scripts/reality/without-test-credentials.py" pnpm exec tsx services/api-gateway/src/server.ts > "$STORE/gateway.log" 2>&1 &
GATEWAY_PID=$!
for _ in $(seq 1 60); do curl -fsS "$BASE/healthz" >/dev/null 2>&1 && break; sleep 1; done
curl -fsS "$BASE/healthz" >/dev/null 2>&1 || fail "the gateway never became healthy"
TOKENS="$(curl -fsS -X POST "$BASE/v1/auth/dev/token" -H 'content-type: application/json' -d "{\"email\":\"$EMAIL\",\"display_name\":\"Live\"}")" || fail "dev sign-in"
AT="$(echo "$TOKENS" | json 'd["access_token"]')"
# 返信案は General Assistant の compose。この tenant に入れておく。
curl -fsS -X POST "$BASE/v1/plugins/com.astra.general/install" -H "authorization: Bearer $AT" \
  -H 'content-type: application/json' -d '{"version":"0.1.0","granted_scopes":["artifacts.read","artifacts.write"]}' >/dev/null 2>&1 || true

# ---- 3. fixture を投入（テスト identity だけ。トークンはこの実行のファイルへ）
export ASTRA_SECRET_STORE_FILE="$STORE/secrets.json" ASTRA_LIVE_SEEDED_FILE="$STORE/seeded.json" ASTRA_LIVE_PROVIDER="$PROVIDER"
pnpm exec tsx workers/agent-host/src/live-seed.ts "$NONCE" > "$STORE/seed.log" 2>&1 || fail "seeding the fixture (see seed.log)"
cat "$STORE/seed.log"

# ---- 4. 端末 worker がread-only grantで同期。write tokenは承認項目を観測するまで保存しない。
GRANTS="com.astra.gmail=email.read,email.send,email.draft,email.modify;com.astra.google-calendar=calendar.read;com.astra.outlook=email.read,calendar.read,email.send;com.astra.microsoft-todo=tasks.read"
python3 "$ROOT/scripts/reality/without-test-credentials.py" env -u CLAUDECODE -u CLAUDE_CODE_CHILD_SESSION -u CLAUDE_CODE_ENTRYPOINT -u CLAUDE_CODE_SESSION_ID \
  ASTRA_API_URL="$BASE" ASTRA_HOST_TOKEN="$AT" ASTRA_DEVICE_LABEL="work-context-live" \
  ASTRA_GRANTED_SCOPES="$GRANTS" ASTRA_WORK_SYNC_INTERVAL_MIN=1 \
  ASTRA_WORK_SYNC_GOOGLE_QUERY="$NONCE" \
  ASTRA_WORK_SYNC_MICROSOFT_QUERY="$NONCE" \
  ASTRA_OAUTH_MICROSOFT_READ_CLIENT_ID="${ASTRA_TEST_MS_READ_CLIENT_ID:-${ASTRA_TEST_MICROSOFT_READ_CLIENT_ID:-}}" \
  ASTRA_OAUTH_MICROSOFT_WRITE_CLIENT_ID="${ASTRA_TEST_MS_WRITE_CLIENT_ID:-${ASTRA_TEST_MICROSOFT_WRITE_CLIENT_ID:-}}" \
  ASTRA_OAUTH_GOOGLE_CLIENT_SECRET="${ASTRA_TEST_GOOGLE_READ_CLIENT_SECRET:-${ASTRA_TEST_GOOGLE_CLIENT_SECRET:-}}" \
  ASTRA_OAUTH_GOOGLE_CLIENT_ID="${ASTRA_TEST_GOOGLE_READ_CLIENT_ID:-${ASTRA_TEST_GOOGLE_CLIENT_ID:-}}" ASTRA_OAUTH_MICROSOFT_CLIENT_ID="${ASTRA_TEST_MS_READ_CLIENT_ID:-${ASTRA_TEST_MICROSOFT_READ_CLIENT_ID:-${ASTRA_TEST_MS_CLIENT_ID:-${ASTRA_TEST_MICROSOFT_CLIENT_ID:-}}}}" \
  pnpm exec tsx workers/agent-host/src/main.ts > "$STORE/host.log" 2>&1 &
HOST_PID=$!

# ---- 5. 閉ループを機械で assert（Home → 返信 → 会議 → 次の brief）
ASTRA_LIVE_ASSERT_PHASE_ONLY=1 pnpm exec tsx workers/agent-host/src/live-assert.ts "$BASE" "$AT" "$STORE/seeded.json" 240 | tee "$OUT/result-$PROVIDER.txt"
RC=${PIPESTATUS[0]}
[ "$RC" = 0 ] || fail "see $OUT/result-$PROVIDER.txt and $OUT/host.log"
echo "  artifacts: $OUT (result-$PROVIDER.txt / seed.log / host.log / worker.log / gateway.log)"
exit 0
