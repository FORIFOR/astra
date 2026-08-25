#!/usr/bin/env bash
# 使い捨ての検証用データベースを用意してコマンドを実行し、後始末する。
#
#   ./infra/db/with-test-db.sh pnpm --filter @astra/db test
#
# 与えるコマンドには次の環境変数が渡る:
#   TEST_DATABASE_URL          非 superuser ロール astra_app で接続する URL（RLS が効く）
#   TEST_IDENTITY_DATABASE_URL identity 専用ロール astra_identity で接続する URL
#   TEST_ADMIN_DATABASE_URL    所有者で接続する URL（診断用）
#
# 必要: dbmate, psql, ローカルクラスタで CREATE DATABASE / CREATE ROLE できる権限
# 環境変数:
#   ASTRA_TEST_PGHOST (既定 localhost) / ASTRA_TEST_PGPORT (既定 5432)
#   ASTRA_TEST_DB     (既定 astra_test_$$)
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
HOST="${ASTRA_TEST_PGHOST:-localhost}"
PORT="${ASTRA_TEST_PGPORT:-5432}"
DB="${ASTRA_TEST_DB:-astra_test_$$}"
APP_PASSWORD='astra_app'

ADMIN_URL="postgres://${HOST}:${PORT}/${DB}?sslmode=disable"
APP_URL="postgres://astra_app:${APP_PASSWORD}@${HOST}:${PORT}/${DB}?sslmode=disable"
IDENTITY_URL="postgres://astra_identity:astra_identity@${HOST}:${PORT}/${DB}?sslmode=disable"

cleanup() {
  local rc=$?
  dbmate --url "$ADMIN_URL" --migrations-dir "$ROOT/infra/db/migrations" --no-dump-schema drop >/dev/null 2>&1 || true
  # ロールは他のデータベースを跨ぐので、検証で作ったものは必ず落とす
  psql "postgres://${HOST}:${PORT}/postgres" -X -q -c 'DROP ROLE IF EXISTS astra_app' >/dev/null 2>&1 || true
  psql "postgres://${HOST}:${PORT}/postgres" -X -q -c 'DROP ROLE IF EXISTS astra_migrate' >/dev/null 2>&1 || true
  psql "postgres://${HOST}:${PORT}/postgres" -X -q -c 'DROP ROLE IF EXISTS astra_identity' >/dev/null 2>&1 || true
  exit $rc
}
trap cleanup EXIT

dbmate --url "$ADMIN_URL" --migrations-dir "$ROOT/infra/db/migrations" --no-dump-schema drop >/dev/null 2>&1 || true
dbmate --url "$ADMIN_URL" --migrations-dir "$ROOT/infra/db/migrations" --no-dump-schema up >/dev/null

# ロールと権限。マイグレーション後に流す（GRANT ON ALL TABLES は既存テーブルにしか効かない）
psql "$ADMIN_URL" -X -q -v ON_ERROR_STOP=1 -f "$ROOT/infra/db/bootstrap.sql" >/dev/null

# RLS が実際に効くことを前提にしているので、接続ロールが特権を持っていないことを確かめる
PRIV=$(psql "$ADMIN_URL" -X -t -A -c \
  "SELECT rolsuper OR rolbypassrls FROM pg_roles WHERE rolname='astra_app'")
if [ "$PRIV" != "f" ]; then
  echo "FAIL: astra_app must be neither superuser nor BYPASSRLS (RLS would not apply)" >&2
  exit 1
fi

TEST_DATABASE_URL="$APP_URL" \
TEST_IDENTITY_DATABASE_URL="$IDENTITY_URL" \
TEST_ADMIN_DATABASE_URL="$ADMIN_URL" \
  "$@"
