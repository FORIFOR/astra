#!/usr/bin/env bash
# Requires an already-authorized read grant. Uses an isolated DB and no external writes.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
OUT="${ASTRA_LIVE_OUT:-/tmp/astra-initial-profile-live}"
mkdir -p "$OUT"
STORE="$(mktemp -d)"
DB="astra_initial_live_$$"
PGHOST="${ASTRA_TEST_PGHOST:-localhost}"
PGPORT="${ASTRA_TEST_PGPORT:-5433}"
PGUSER="${ASTRA_TEST_PGUSER:-astra}"
export PGPASSWORD="${ASTRA_TEST_PGPASSWORD:-astra}"
ADMIN="postgres://${PGUSER}:${PGPASSWORD}@${PGHOST}:${PGPORT}/${DB}?sslmode=disable"
GATEWAY_PID=""
cleanup() {
  local rc=$?
  trap - EXIT
  if [[ -n "$GATEWAY_PID" ]]; then
    python3 "$ROOT/scripts/reality/stop-test-process.py" "$GATEWAY_PID" >/dev/null 2>&1 || true
    wait "$GATEWAY_PID" 2>/dev/null || true
  fi
  if ! dbmate --url "$ADMIN" --no-dump-schema drop >/dev/null 2>&1; then
    echo 'INITIAL_PROFILE_LIVE_API=FAIL database cleanup' >&2
    rc=1
  fi
  rm -rf "$STORE"
  exit "$rc"
}
trap cleanup EXIT
# No shared role removal; other local databases may be using these roles.
dbmate --url "$ADMIN" --migrations-dir infra/db/migrations --no-dump-schema up > "$STORE/migrate.log"
psql "$ADMIN" -X -q -v ON_ERROR_STOP=1 -f infra/db/bootstrap.sql > "$STORE/bootstrap.log" 2>&1
export DATABASE_URL="postgres://astra_app:astra_app@${PGHOST}:${PGPORT}/${DB}?sslmode=disable"
export ASTRA_DB_IDENTITY_URL="postgres://astra_identity:astra_identity@${PGHOST}:${PGPORT}/${DB}?sslmode=disable"
export ASTRA_ENV=development ASTRA_API_PORT="${ASTRA_LIVE_PORT:-3499}"
export ASTRA_API_URL="http://127.0.0.1:${ASTRA_API_PORT}"
export REDIS_URL="${REDIS_URL:-redis://localhost:6380}" TEMPORAL_ADDRESS="${TEMPORAL_ADDRESS:-localhost:7233}"
export ASTRA_OBJECT_STORE_ROOT="$STORE" ASTRA_RECORDING_ROOT="$STORE/recordings"
python3 scripts/reality/without-test-credentials.py pnpm exec tsx services/api-gateway/src/server.ts > "$STORE/gateway.log" 2>&1 &
GATEWAY_PID=$!
for _ in $(seq 1 60); do
  curl -fsS "$ASTRA_API_URL/healthz" >/dev/null 2>&1 && break
  kill -0 "$GATEWAY_PID" 2>/dev/null || { echo 'gateway startup failed' >&2; exit 1; }
  sleep 1
done
curl -fsS "$ASTRA_API_URL/healthz" >/dev/null 2>&1 || exit 1
pnpm exec tsx workers/agent-host/src/live-initial-profile.ts | tee "$OUT/result-${ASTRA_LIVE_PROVIDER:-google}.json"
