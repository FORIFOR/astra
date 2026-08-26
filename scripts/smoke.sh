#!/usr/bin/env bash
# 本番と同じ起動経路の smoke test。
#
#   pnpm dev:infra && pnpm smoke
#
# なぜ受け入れテストと別に要るか:
#   evals/actions/phase0 は @temporalio/testing の内蔵サーバを使い、
#   buildApp を直接叩く。つまり **server.ts と worker-main.ts の起動経路自体は
#   一度も通らない**。設定の解決、実 Temporal への接続、プラグインの seed、
#   listen までを確かめるにはここが要る。実際、この経路でしか出ない不具合を 3 件見つけた。
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

PORT="${ASTRA_SMOKE_PORT:-3399}"
PGHOST="${ASTRA_TEST_PGHOST:-localhost}"
PGPORT="${ASTRA_TEST_PGPORT:-5433}"
PGSUPER="${ASTRA_TEST_PGUSER:-astra}"
export PGPASSWORD="${ASTRA_TEST_PGPASSWORD:-astra}"
DB="astra_smoke_$$"
# 実行ごとに専用の queue を使う。前の実行の残骸に枠を食われないため。
TASK_QUEUE="astra.task.smoke.$$"
ADMIN_URL="postgres://${PGSUPER}:${PGPASSWORD}@${PGHOST}:${PGPORT}/${DB}?sslmode=disable"
STORE="$(mktemp -d)"
BASE="http://127.0.0.1:${PORT}"

GATEWAY_PID=""
WORKER_PID=""

cleanup() {
  local rc=$?
  # ジョブ制御の "Terminated" 通知を出さずに落とす
  set +m
  [ -n "$WORKER_PID" ] && { kill "$WORKER_PID" 2>/dev/null || true; wait "$WORKER_PID" 2>/dev/null || true; }
  [ -n "$GATEWAY_PID" ] && { kill "$GATEWAY_PID" 2>/dev/null || true; wait "$GATEWAY_PID" 2>/dev/null || true; }
  dbmate --url "$ADMIN_URL" --migrations-dir "$ROOT/infra/db/migrations" --no-dump-schema drop >/dev/null 2>&1 || true
  psql "postgres://${PGSUPER}:${PGPASSWORD}@${PGHOST}:${PGPORT}/postgres" -X -q \
    -c 'DROP ROLE IF EXISTS astra_app' -c 'DROP ROLE IF EXISTS astra_identity' \
    -c 'DROP ROLE IF EXISTS astra_migrate' >/dev/null 2>&1 || true
  if [ $rc -ne 0 ] && [ -f "$STORE/worker.log" ]; then
    echo "--- worker log ---" >&2
    tail -30 "$STORE/worker.log" >&2
  fi
  # この実行が起こしたワークフローを残さない。
  # 使い捨て DB は消えるので、残すと永久に再試行し続ける。
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
            workflow terminate --workflow-id "$wid" --reason "smoke cleanup" >/dev/null 2>&1 || true
        done
  fi
  rm -rf "$STORE"
  exit $rc
}
trap cleanup EXIT

say() { printf '\n\033[1m%s\033[0m\n' "$1"; }
fail() { echo "FAIL: $1" >&2; exit 1; }

say "provisioning ${DB}"
dbmate --url "$ADMIN_URL" --migrations-dir "$ROOT/infra/db/migrations" --no-dump-schema up >/dev/null
psql "$ADMIN_URL" -X -q -v ON_ERROR_STOP=1 -f "$ROOT/infra/db/bootstrap.sql" >/dev/null

export ASTRA_ENV=development
export ASTRA_API_PORT="$PORT"
export ASTRA_LOG_LEVEL=warn
export DATABASE_URL="postgres://astra_app:astra_app@${PGHOST}:${PGPORT}/${DB}?sslmode=disable"
export ASTRA_DB_IDENTITY_URL="postgres://astra_identity:astra_identity@${PGHOST}:${PGPORT}/${DB}?sslmode=disable"
export REDIS_URL="${REDIS_URL:-redis://localhost:6380}"
export TEMPORAL_ADDRESS="${TEMPORAL_ADDRESS:-localhost:7233}"
export ASTRA_OBJECT_STORE_ROOT="$STORE"
export ASTRA_BUILTIN_PLUGINS_DIR="$ROOT/plugins/builtin"
export ASTRA_TASK_QUEUE="$TASK_QUEUE"

say "starting the worker and the gateway"
pnpm exec tsx workers/task-worker/src/worker-main.ts > "$STORE/worker.log" 2>&1 &
WORKER_PID=$!
pnpm exec tsx services/api-gateway/src/server.ts > "$STORE/gateway.log" 2>&1 &
GATEWAY_PID=$!

for _ in $(seq 1 60); do
  curl -fsS "$BASE/healthz" >/dev/null 2>&1 && break
  sleep 1
done
curl -fsS "$BASE/healthz" >/dev/null 2>&1 || {
  tail -30 "$STORE/gateway.log" >&2
  fail "the gateway never became healthy"
}

json() { python3 -c "import json,sys;d=json.load(sys.stdin);print($1)"; }

say "readiness reaches every dependency"
READY="$(curl -fsS "$BASE/readyz")"
echo "$READY" | json 'd["checks"]' | grep -q "'ok'" || fail "readyz: $READY"
echo "  $(echo "$READY" | json 'd["checks"]')"

say "auth provisions a tenant"
TOKENS="$(curl -fsS -X POST "$BASE/v1/auth/dev/token" -H 'content-type: application/json' \
  -d '{"email":"smoke@example.com","display_name":"Smoke"}')"
AT="$(echo "$TOKENS" | json 'd["access_token"]')"
TENANT="$(curl -fsS "$BASE/v1/me" -H "authorization: Bearer $AT" | json 'd["tenant"]["id"]')"
echo "  tenant $TENANT"

say "the bundled plugins are in the catalog"
COUNT="$(curl -fsS "$BASE/v1/plugins/catalog" -H "authorization: Bearer $AT" | json 'len(d["items"])')"
[ "$COUNT" = "5" ] || fail "expected 5 bundled plugins, found $COUNT"
echo "  $COUNT plugins"

say "a task runs through the real Temporal server"
KEY="smoke-$$"
CREATED="$(curl -fsS -X POST "$BASE/v1/tasks" -H "authorization: Bearer $AT" \
  -H 'content-type: application/json' -H "idempotency-key: $KEY" \
  -d '{"kind":"echo","input":{"message":"smoke","steps":2}}')"
TASK="$(echo "$CREATED" | json 'd["id"]')"

EVENTS="$(curl -fsSN --max-time 60 "$BASE/v1/tasks/$TASK/stream" -H "authorization: Bearer $AT")"
SEQ="$(printf '%s' "$EVENTS" | grep -c '^id: ' || true)"
printf '%s' "$EVENTS" | grep -q 'event: task.completed' || fail "the task never completed"
echo "  $SEQ events, ending in task.completed"

say "the same idempotency key returns the same task"
AGAIN="$(curl -fsS -X POST "$BASE/v1/tasks" -H "authorization: Bearer $AT" \
  -H 'content-type: application/json' -H "idempotency-key: $KEY" \
  -d '{"kind":"echo","input":{"message":"smoke","steps":2}}' | json 'd["id"]')"
[ "$AGAIN" = "$TASK" ] || fail "resend produced a different task"

say "the artifact matches its recorded checksum"
ARTIFACT="$(curl -fsS "$BASE/v1/tasks/$TASK" -H "authorization: Bearer $AT" | json 'd["result_artifact_id"]')"
[ "$ARTIFACT" != "None" ] || fail "the task produced no artifact"
RECORDED="$(curl -fsS "$BASE/v1/artifacts/$ARTIFACT" -H "authorization: Bearer $AT" | json 'd["sha256"]')"
ACTUAL="$(curl -fsS "$BASE/v1/artifacts/$ARTIFACT/content" -H "authorization: Bearer $AT" | shasum -a 256 | cut -d' ' -f1)"
[ "$RECORDED" = "$ACTUAL" ] || fail "checksum mismatch: $RECORDED vs $ACTUAL"
echo "  sha256 $RECORDED"

say "another tenant sees 404, not 403"
OTHER="$(curl -fsS -X POST "$BASE/v1/auth/dev/token" -H 'content-type: application/json' \
  -d '{"email":"other@example.com","display_name":"Other"}' | json 'd["access_token"]')"
for path in "/v1/tasks/$TASK" "/v1/artifacts/$ARTIFACT"; do
  CODE="$(curl -s -o /dev/null -w '%{http_code}' "$BASE$path" -H "authorization: Bearer $OTHER")"
  [ "$CODE" = "404" ] || fail "$path returned $CODE for another tenant"
done
echo "  both 404"

printf '\n\033[1;32mSMOKE PASSED\033[0m\n'
