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
#       Google Workspace のテスト identity。scope: gmail.insert gmail.readonly gmail.modify gmail.send calendar.events
#   ASTRA_TEST_MS_CLIENT_ID / ASTRA_TEST_MS_REFRESH_TOKEN               [ASTRA_TEST_OUTLOOK_SINK]
#       Microsoft tenant のテスト identity。scope: Mail.ReadWrite Mail.Send Calendars.ReadWrite Tasks.ReadWrite offline_access
#   Claude Code CLI（端末の LLM。返信案を書く）。sink は既定で identity 自身。
#
# 流れ: preflight → 使い捨て DB + gateway → 固定 fixture を投入（Mail A/B・顧客定例・タスク）→
#       端末 worker が読む接続だけで同期 → 期待した Work Graph（案件・期限・待ち・会議・pressure HIGH）を assert → 掃除。
# 揃っていない前提は AUTOMATION_MISSING と名指しする（PASS を捏造しない。人を呼ばない）。
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

PROVIDER="${ASTRA_LIVE_PROVIDER:-google}"
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

# ---- 1. preflight（この provider に要るものだけ）
NAME="$([ "$PROVIDER" = microsoft ] && echo MICROSOFT_DAILY_WORK_LIVE || echo GOOGLE_DAILY_WORK_LIVE)"
have=(); missing=()
if [ "$PROVIDER" = microsoft ]; then
  [[ -n "${ASTRA_TEST_MS_CLIENT_ID:-}${ASTRA_TEST_MICROSOFT_CLIENT_ID:-}" && -n "${ASTRA_TEST_MS_REFRESH_TOKEN:-}${ASTRA_TEST_MICROSOFT_REFRESH_TOKEN:-}" ]] && have+=("microsoft test identity") || missing+=("Microsoft tenant test identity (ASTRA_TEST_MS_CLIENT_ID + ASTRA_TEST_MS_REFRESH_TOKEN; scopes Mail.ReadWrite/Mail.Send/Calendars.ReadWrite/Tasks.ReadWrite/offline_access)")
else
  [[ -n "${ASTRA_TEST_GOOGLE_CLIENT_ID:-}" && -n "${ASTRA_TEST_GOOGLE_REFRESH_TOKEN:-}" ]] && have+=("google test identity") || missing+=("Google Workspace test identity (ASTRA_TEST_GOOGLE_CLIENT_ID + ASTRA_TEST_GOOGLE_REFRESH_TOKEN; scopes gmail.insert/gmail.readonly/gmail.modify/gmail.send/calendar.events)")
fi
pg_isready -h "$PGHOST" -p "$PGPORT" >/dev/null 2>&1 && have+=("postgres:$PGPORT") || missing+=("postgres at $PGHOST:$PGPORT (pnpm dev:infra)")
command -v dbmate >/dev/null 2>&1 && have+=("dbmate") || missing+=("dbmate")
command -v claude >/dev/null 2>&1 && have+=("claude code cli") || missing+=("Claude Code CLI on PATH (device LLM for the draft)")
echo "$NAME have=[${have[*]:-}]"
if [[ ${#missing[@]} -gt 0 ]]; then
  printf '%s=AUTOMATION_MISSING %s\n' "$NAME" "$(IFS=';'; echo "${missing[*]}")"
  exit 3
fi

GATEWAY_PID=""; HOST_PID=""; WORKER_PID=""
cleanup() {
  local rc=$?
  for pid in "$HOST_PID" "$WORKER_PID" "$GATEWAY_PID"; do [ -n "$pid" ] && { kill "$pid" 2>/dev/null || true; wait "$pid" 2>/dev/null || true; }; done
  if [ -f "$STORE/seeded.json" ]; then
    ASTRA_LIVE_PROVIDER="$PROVIDER" ASTRA_SECRET_STORE_FILE="$STORE/secrets.json" pnpm exec tsx workers/agent-host/src/live-seed.ts "$NONCE" --cleanup "$STORE/seeded.json" >> "$OUT/seed.log" 2>&1 || true
  fi
  dbmate --url "$ADMIN_URL" --migrations-dir "$ROOT/infra/db/migrations" --no-dump-schema drop >/dev/null 2>&1 || true
  # bootstrap.sql のロールはクラスタ共通。別DBや別の検証も使用するため、
  # このrunの一時DBを片付ける際に削除してはいけない。
  cp "$STORE"/*.log "$OUT/" 2>/dev/null || true
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
pnpm exec tsx workers/task-worker/src/worker-main.ts > "$STORE/worker.log" 2>&1 &
WORKER_PID=$!
pnpm exec tsx services/api-gateway/src/server.ts > "$STORE/gateway.log" 2>&1 &
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

# ---- 4. 端末 worker が読む接続だけで同期（送る接続のトークンはそもそも無い）
# 読む許可 + 送る許可（送るのは承認と確認を通ってだけ）。
GRANTS="com.astra.gmail=email.read,email.send,email.draft,email.modify;com.astra.google-calendar=calendar.read;com.astra.outlook=email.read,calendar.read,email.send;com.astra.microsoft-todo=tasks.read"
env -u CLAUDECODE -u CLAUDE_CODE_CHILD_SESSION -u CLAUDE_CODE_ENTRYPOINT -u CLAUDE_CODE_SESSION_ID \
  ASTRA_API_URL="$BASE" ASTRA_HOST_TOKEN="$AT" ASTRA_DEVICE_LABEL="work-context-live" \
  ASTRA_GRANTED_SCOPES="$GRANTS" ASTRA_WORK_SYNC_INTERVAL_MIN=1 \
  ASTRA_OAUTH_GOOGLE_CLIENT_ID="${ASTRA_TEST_GOOGLE_CLIENT_ID:-}" ASTRA_OAUTH_MICROSOFT_CLIENT_ID="${ASTRA_TEST_MS_CLIENT_ID:-${ASTRA_TEST_MICROSOFT_CLIENT_ID:-}}" \
  pnpm exec tsx workers/agent-host/src/main.ts > "$STORE/host.log" 2>&1 &
HOST_PID=$!

# ---- 5. 閉ループを機械で assert（Home → 返信 → 会議 → 次の brief）
pnpm exec tsx workers/agent-host/src/live-assert.ts "$BASE" "$AT" "$STORE/seeded.json" 240 | tee "$OUT/result-$PROVIDER.txt"
RC=${PIPESTATUS[0]}
[ "$RC" = 0 ] || fail "see $OUT/result-$PROVIDER.txt and $OUT/host.log"
echo "  artifacts: $OUT (result-$PROVIDER.txt / seed.log / host.log / worker.log / gateway.log)"
exit 0
