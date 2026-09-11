#!/usr/bin/env bash
# SCREENSHOT_CONVERSATION_GATE の実経路: 実 gateway + 実 task worker + 実 agent-host（Claude Code CLI）+ 実 PNG。
#
#   pnpm dev:infra && ./scripts/reality/run-screenshot-e2e.sh
#
# 画像の中にしか無い nonce（ERROR CODE: VX-xxxx）を描いた PNG を「撮った」ことにし、
# 「この画像のエラーコードは？」を送って、端末の worker が Claude Code CLI で PNG を読んだ答えに
# nonce が入るかを機械で確かめる。prompt の中身や file の有無ではなく、**画像を本当に読んだ**ことの証拠。
#
# HUMAN_INTERVENTION = 0。人はクリックも判定もしない。Claude Code CLI のログインは端末のもの
# （Astra は鍵を持たない）。この Mac に無ければ SKIP ではなく FAIL（見たふりはしない）。
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"
export ASTRA_LLM_CLI="${ASTRA_LLM_CLI:-claude_code}"
case "$ASTRA_LLM_CLI" in
  codex) LLM_COMMAND="${ASTRA_CODEX_PATH:-codex}" ;;
  claude_code) LLM_COMMAND="${ASTRA_CLAUDE_CODE_PATH:-claude}" ;;
  *) echo 'FAIL: ASTRA_LLM_CLI must be codex or claude_code'; exit 1 ;;
esac

PORT="${ASTRA_E2E_PORT:-3398}"
PGHOST="${ASTRA_TEST_PGHOST:-localhost}"
PGPORT="${ASTRA_TEST_PGPORT:-5433}"
PGSUPER="${ASTRA_TEST_PGUSER:-astra}"
export PGPASSWORD="${ASTRA_TEST_PGPASSWORD:-astra}"
DB="astra_sce2e_$$"
TASK_QUEUE="astra.task.sce2e.$$"
ADMIN_URL="postgres://${PGSUPER}:${PGPASSWORD}@${PGHOST}:${PGPORT}/${DB}?sslmode=disable"
STORE="$(mktemp -d)"
OUT="${ASTRA_E2E_OUT:-/tmp/astra-screenshot-e2e}"
BASE="http://127.0.0.1:${PORT}"
BIN="$ROOT/apps/astra-macos/.build/debug/AstraMac"
EMAIL="screenshot-e2e-$$@astra.local"
mkdir -p "$OUT"

GATEWAY_PID=""; WORKER_PID=""; HOST_PID=""
cleanup() {
  local rc=$?
  set +m
  for pid in "$HOST_PID" "$WORKER_PID" "$GATEWAY_PID"; do
    [ -n "$pid" ] && { python3 "$ROOT/scripts/reality/stop-test-process.py" "$pid" 2>/dev/null || true; wait "$pid" 2>/dev/null || true; }
  done
  dbmate --url "$ADMIN_URL" --migrations-dir "$ROOT/infra/db/migrations" --no-dump-schema drop >/dev/null 2>&1 || { echo 'SCREENSHOT_E2E=FAIL database cleanup' >&2; rc=1; }
  # bootstrap roles belong to the cluster and may be used by other databases.
  if command -v docker >/dev/null 2>&1; then
    docker exec astra-temporal temporal --address temporal:7233 workflow list \
      --query "TaskQueue='$TASK_QUEUE' AND ExecutionStatus='Running'" --limit 50 --output json 2>/dev/null \
      | python3 -c 'import json,sys
try:
    for row in json.load(sys.stdin) or []:
        print(row["execution"]["workflowId"])
except Exception:
    pass' 2>/dev/null \
      | while read -r wid; do
          [ -n "$wid" ] && docker exec astra-temporal temporal --address temporal:7233 \
            workflow terminate --workflow-id "$wid" --reason "screenshot e2e cleanup" >/dev/null 2>&1 || true
        done
  fi
  cp "$STORE"/*.log "$OUT/" 2>/dev/null || true
  rm -rf "$STORE"
  [ "$rc" != 0 ] || echo 'SCREENSHOT_E2E=PASS'
  exit $rc
}
trap cleanup EXIT
say() { printf '\n\033[1m%s\033[0m\n' "$1"; }
fail() { echo "SCREENSHOT_E2E=FAIL $1" >&2; for f in host worker gateway; do [ -f "$STORE/$f.log" ] && { echo "--- $f.log ---" >&2; tail -25 "$STORE/$f.log" >&2; }; done; exit 1; }
json() { python3 -c "import json,sys;d=json.load(sys.stdin);print($1)"; }

[ -x "$BIN" ] || fail "build the app first: swift build --package-path apps/astra-macos"
command -v "$LLM_COMMAND" >/dev/null 2>&1 || fail "$LLM_COMMAND is not on PATH"

say "provisioning ${DB}"
dbmate --url "$ADMIN_URL" --migrations-dir "$ROOT/infra/db/migrations" --no-dump-schema up >/dev/null || fail "dbmate up"
psql "$ADMIN_URL" -X -q -v ON_ERROR_STOP=1 -f "$ROOT/infra/db/bootstrap.sql" >/dev/null || fail "bootstrap.sql"

export ASTRA_ENV=development
export ASTRA_API_PORT="$PORT"
export ASTRA_LOG_LEVEL=info
export DATABASE_URL="postgres://astra_app:astra_app@${PGHOST}:${PGPORT}/${DB}?sslmode=disable"
export ASTRA_DB_IDENTITY_URL="postgres://astra_identity:astra_identity@${PGHOST}:${PGPORT}/${DB}?sslmode=disable"
export REDIS_URL="${REDIS_URL:-redis://localhost:6380}"
export TEMPORAL_ADDRESS="${TEMPORAL_ADDRESS:-localhost:7233}"
export ASTRA_OBJECT_STORE_ROOT="$STORE"
export ASTRA_RECORDING_ROOT="$STORE/recordings"
export ASTRA_BUILTIN_PLUGINS_DIR="$ROOT/plugins/builtin"
export ASTRA_TASK_QUEUE="$TASK_QUEUE"
# 受け渡し場所は app と worker で同じ（キャッシュ。この実行だけの場所）。
export ASTRA_VISUAL_CONTEXT_DIR="$STORE/visual-context"

say "starting the task worker and the gateway"
pnpm exec tsx workers/task-worker/src/worker-main.ts > "$STORE/worker.log" 2>&1 &
WORKER_PID=$!
pnpm exec tsx services/api-gateway/src/server.ts > "$STORE/gateway.log" 2>&1 &
GATEWAY_PID=$!
for _ in $(seq 1 60); do curl -fsS "$BASE/healthz" >/dev/null 2>&1 && break; sleep 1; done
curl -fsS "$BASE/healthz" >/dev/null 2>&1 || fail "the gateway never became healthy"

say "signing in the e2e user (the host and the app must be the same user)"
TOKENS="$(curl -fsS -X POST "$BASE/v1/auth/dev/token" -H 'content-type: application/json' \
  -d "{\"email\":\"$EMAIL\",\"display_name\":\"E2E\"}")" || fail "dev sign-in"
AT="$(echo "$TOKENS" | json 'd["access_token"]')"
# General Assistant は同梱だが、念のため入れておく（既に在れば無視）。
curl -fsS -X POST "$BASE/v1/plugins/com.astra.general/install" -H "authorization: Bearer $AT" \
  -H 'content-type: application/json' -d '{"version":"0.1.0","granted_scopes":["artifacts.read","artifacts.write"]}' >/dev/null 2>&1 || true

say "starting the local agent host ($ASTRA_LLM_CLI, this device's own login)"
# 自分自身が Claude Code の中で動いているときは、入れ子の印を外して素の CLI として呼ぶ。
env -u CLAUDECODE -u CLAUDE_CODE_CHILD_SESSION -u CLAUDE_CODE_ENTRYPOINT -u CLAUDE_CODE_SESSION_ID \
  ASTRA_API_URL="$BASE" ASTRA_HOST_TOKEN="$AT" ASTRA_DEVICE_LABEL="screenshot-e2e" \
  pnpm exec tsx workers/agent-host/src/main.ts > "$STORE/host.log" 2>&1 &
HOST_PID=$!
ONLINE=""
for _ in $(seq 1 60); do
  ONLINE="$(curl -fsS "$BASE/v1/agent-hosts" -H "authorization: Bearer $AT" 2>/dev/null | json "sum(1 for h in d['items'] if '$ASTRA_LLM_CLI' in (h.get('models') or []))" 2>/dev/null || echo 0)"
  [ "$ONLINE" != "0" ] && [ -n "$ONLINE" ] && break
  sleep 1
done
[ "$ONLINE" != "0" ] || fail "no online host with $ASTRA_LLM_CLI (is the selected CLI signed in on this Mac?)"
echo "  host online with $ASTRA_LLM_CLI"

say "asking about a screenshot whose content exists only in the pixels"
"$BIN" --selftest screenshote2e "$BASE" --email "$EMAIL" --out "$OUT" 2>"$STORE/app.stderr.log" | tee "$OUT/result.txt"
pipeline_status=("${PIPESTATUS[@]}")
[ "${pipeline_status[0]}" = 0 ] && [ "${pipeline_status[1]}" = 0 ] || fail "app or evidence capture failed"
grep -Eq '^SCREENSHOT_E2E=PASS( nonce=|$)' "$OUT/result.txt" || fail "see $OUT/result.txt"
echo "  artifacts: $OUT (fixture.png / answer.txt / host.log)"
exit 0
