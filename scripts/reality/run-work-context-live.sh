#!/usr/bin/env bash
# WORK_CONTEXT_LIVE_GATE — 実サービスに繋いだ Work Context の無人検証。
#
#   pnpm dev:infra && ./scripts/reality/run-work-context-live.sh
#
# 人は OAuth を押さない（人手 0）。専用のテスト identity を**事前に**用意し、その refresh token を
# 環境変数で渡す。本人のアカウントも login keychain も触らない（トークンはこの実行だけのファイル）。
#
#   ASTRA_TEST_GOOGLE_CLIENT_ID / ASTRA_TEST_GOOGLE_REFRESH_TOKEN
#       Google Workspace のテスト identity。scope: gmail.insert gmail.readonly gmail.modify calendar.events
#   ASTRA_TEST_MICROSOFT_CLIENT_ID / ASTRA_TEST_MICROSOFT_REFRESH_TOKEN
#       Microsoft tenant のテスト identity。scope: Mail.ReadWrite Calendars.ReadWrite Tasks.ReadWrite offline_access
#
# 流れ: preflight → 使い捨て DB + gateway → 固定 fixture を投入（Mail A/B・顧客定例・タスク）→
#       端末 worker が読む接続だけで同期 → 期待した Work Graph（案件・期限・待ち・会議・pressure HIGH）を assert → 掃除。
# 揃っていない前提は AUTOMATION_MISSING と名指しする（PASS を捏造しない。人を呼ばない）。
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

PORT="${ASTRA_LIVE_PORT:-3399}"
PGHOST="${ASTRA_TEST_PGHOST:-localhost}"
PGPORT="${ASTRA_TEST_PGPORT:-5433}"
PGSUPER="${ASTRA_TEST_PGUSER:-astra}"
export PGPASSWORD="${ASTRA_TEST_PGPASSWORD:-astra}"
DB="astra_wclive_$$"
ADMIN_URL="postgres://${PGSUPER}:${PGPASSWORD}@${PGHOST}:${PGPORT}/${DB}?sslmode=disable"
STORE="$(mktemp -d)"
OUT="${ASTRA_LIVE_OUT:-/tmp/astra-work-context-live}"
BASE="http://127.0.0.1:${PORT}"
EMAIL="work-context-live-$$@astra.local"
NONCE="WC$(date +%s | tail -c 6)"
mkdir -p "$OUT"

# ---- 1. preflight
have=(); missing=()
[[ -n "${ASTRA_TEST_GOOGLE_CLIENT_ID:-}" && -n "${ASTRA_TEST_GOOGLE_REFRESH_TOKEN:-}" ]] && have+=("google test identity") || missing+=("Google Workspace test identity (ASTRA_TEST_GOOGLE_CLIENT_ID + ASTRA_TEST_GOOGLE_REFRESH_TOKEN, scopes gmail.insert/gmail.readonly/gmail.modify/calendar.events)")
[[ -n "${ASTRA_TEST_MICROSOFT_CLIENT_ID:-}" && -n "${ASTRA_TEST_MICROSOFT_REFRESH_TOKEN:-}" ]] && have+=("microsoft test identity") || missing+=("Microsoft tenant test identity (ASTRA_TEST_MICROSOFT_CLIENT_ID + ASTRA_TEST_MICROSOFT_REFRESH_TOKEN, scopes Mail.ReadWrite/Calendars.ReadWrite/Tasks.ReadWrite/offline_access)")
pg_isready -h "$PGHOST" -p "$PGPORT" >/dev/null 2>&1 && have+=("postgres:$PGPORT") || missing+=("postgres at $PGHOST:$PGPORT (pnpm dev:infra)")
command -v dbmate >/dev/null 2>&1 && have+=("dbmate") || missing+=("dbmate")
echo "WORK_CONTEXT_LIVE have=[${have[*]:-}]"
# identity は片方だけでも回す（在るものだけ検証し、無い方は名指しする）
identities=0
[[ -n "${ASTRA_TEST_GOOGLE_REFRESH_TOKEN:-}" ]] && identities=$((identities+1))
[[ -n "${ASTRA_TEST_MICROSOFT_REFRESH_TOKEN:-}" ]] && identities=$((identities+1))
hard=()
for m in "${missing[@]:-}"; do [[ -n "$m" && "$m" != *"test identity"* ]] && hard+=("$m"); done
if [[ $identities -eq 0 || ${#hard[@]} -gt 0 ]]; then
  printf 'WORK_CONTEXT_LIVE_GATE=AUTOMATION_MISSING %s\n' "$(IFS=';'; echo "${missing[*]}")"
  exit 3
fi

GATEWAY_PID=""; HOST_PID=""
cleanup() {
  local rc=$?
  for pid in "$HOST_PID" "$GATEWAY_PID"; do [ -n "$pid" ] && { kill "$pid" 2>/dev/null || true; wait "$pid" 2>/dev/null || true; }; done
  if [ -f "$STORE/seeded.json" ]; then
    ASTRA_SECRET_STORE_FILE="$STORE/secrets.json" pnpm exec tsx workers/agent-host/src/live-seed.ts "$NONCE" --cleanup "$STORE/seeded.json" >> "$OUT/seed.log" 2>&1 || true
  fi
  dbmate --url "$ADMIN_URL" --migrations-dir "$ROOT/infra/db/migrations" --no-dump-schema drop >/dev/null 2>&1 || true
  psql "postgres://${PGSUPER}:${PGPASSWORD}@${PGHOST}:${PGPORT}/postgres" -X -q \
    -c 'DROP ROLE IF EXISTS astra_app' -c 'DROP ROLE IF EXISTS astra_identity' \
    -c 'DROP ROLE IF EXISTS astra_migrate' -c 'DROP ROLE IF EXISTS astra_share' >/dev/null 2>&1 || true
  cp "$STORE"/*.log "$OUT/" 2>/dev/null || true
  rm -rf "$STORE"   # トークンのファイルはここで消える
  exit $rc
}
trap cleanup EXIT
fail() { echo "WORK_CONTEXT_LIVE_GATE=FAIL $1" >&2; for f in host gateway seed; do [ -f "$STORE/$f.log" ] && { echo "--- $f.log ---" >&2; tail -25 "$STORE/$f.log" >&2; }; done; exit 1; }
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
pnpm exec tsx services/api-gateway/src/server.ts > "$STORE/gateway.log" 2>&1 &
GATEWAY_PID=$!
for _ in $(seq 1 60); do curl -fsS "$BASE/healthz" >/dev/null 2>&1 && break; sleep 1; done
curl -fsS "$BASE/healthz" >/dev/null 2>&1 || fail "the gateway never became healthy"
TOKENS="$(curl -fsS -X POST "$BASE/v1/auth/dev/token" -H 'content-type: application/json' -d "{\"email\":\"$EMAIL\",\"display_name\":\"Live\"}")" || fail "dev sign-in"
AT="$(echo "$TOKENS" | json 'd["access_token"]')"

# ---- 3. fixture を投入（テスト identity だけ。トークンはこの実行のファイルへ）
export ASTRA_SECRET_STORE_FILE="$STORE/secrets.json" ASTRA_LIVE_SEEDED_FILE="$STORE/seeded.json"
pnpm exec tsx workers/agent-host/src/live-seed.ts "$NONCE" > "$STORE/seed.log" 2>&1 || fail "seeding the fixture (see seed.log)"
cat "$STORE/seed.log"

# ---- 4. 端末 worker が読む接続だけで同期（送る接続のトークンはそもそも無い）
GRANTS="com.astra.gmail=email.read;com.astra.google-calendar=calendar.read;com.astra.outlook=email.read,calendar.read;com.astra.microsoft-todo=tasks.read"
env -u CLAUDECODE -u CLAUDE_CODE_CHILD_SESSION -u CLAUDE_CODE_ENTRYPOINT -u CLAUDE_CODE_SESSION_ID \
  ASTRA_API_URL="$BASE" ASTRA_HOST_TOKEN="$AT" ASTRA_DEVICE_LABEL="work-context-live" \
  ASTRA_GRANTED_SCOPES="$GRANTS" ASTRA_WORK_SYNC_INTERVAL_MIN=1 \
  ASTRA_OAUTH_GOOGLE_CLIENT_ID="${ASTRA_TEST_GOOGLE_CLIENT_ID:-}" ASTRA_OAUTH_MICROSOFT_CLIENT_ID="${ASTRA_TEST_MICROSOFT_CLIENT_ID:-}" \
  pnpm exec tsx workers/agent-host/src/main.ts > "$STORE/host.log" 2>&1 &
HOST_PID=$!

# ---- 5. 期待した Work Graph になるか（機械で assert）
pnpm exec tsx workers/agent-host/src/live-assert.ts "$BASE" "$AT" "$STORE/seeded.json" 240 | tee "$OUT/result.txt"
RC=${PIPESTATUS[0]}
[ "$RC" = 0 ] || fail "see $OUT/result.txt and $OUT/host.log"
echo "  artifacts: $OUT (result.txt / seed.log / host.log / gateway.log)"
exit 0
