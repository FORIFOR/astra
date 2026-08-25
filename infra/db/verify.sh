#!/usr/bin/env bash
# マイグレーションの検証。使い捨て DB を作って up → 不変条件検査 → down → 破棄する。
# CI（P0-18）からもこのスクリプトを呼ぶ。
#
#   DATABASE_URL=postgres://user@localhost:5432/astra_verify?sslmode=disable ./infra/db/verify.sh
#
# 必要: dbmate, psql, DATABASE_URL の指す DB を作成/削除できる権限
set -euo pipefail

: "${DATABASE_URL:?DATABASE_URL is required}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
MIG="$ROOT/infra/db/migrations"

echo "==> drop + up"
dbmate --url "$DATABASE_URL" --migrations-dir "$MIG" drop >/dev/null 2>&1 || true
dbmate --url "$DATABASE_URL" --migrations-dir "$MIG" --no-dump-schema up

echo "==> every table carrying tenant_id must have RLS enabled, forced and policied"
UNCOVERED=$(psql "$DATABASE_URL" -X -t -A <<'SQL'
SELECT coalesce(string_agg(c.relname, ', '), '')
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
 WHERE c.relkind = 'r'
   AND EXISTS (SELECT 1 FROM information_schema.columns col
                WHERE col.table_name = c.relname AND col.column_name = 'tenant_id')
   AND NOT (c.relrowsecurity AND c.relforcerowsecurity
            AND (SELECT count(*) FROM pg_policy p WHERE p.polrelid = c.oid) > 0);
SQL
)
if [ -n "$UNCOVERED" ]; then
  echo "FAIL: tenant tables without full RLS coverage: $UNCOVERED" >&2
  exit 1
fi
echo "    ok"

# 空テーブルでも落ちること。行レベルトリガだと 0 行 UPDATE と TRUNCATE を素通しする。
echo "==> append-only tables must reject UPDATE, DELETE and TRUNCATE (even when empty)"
for t in task_events action_receipts audit_events; do
  for op in "UPDATE $t SET tenant_id = tenant_id" "DELETE FROM $t" "TRUNCATE $t"; do
    if psql "$DATABASE_URL" -X -q -v ON_ERROR_STOP=1 -c "$op" >/dev/null 2>&1; then
      echo "FAIL: $t accepted \"$op\"" >&2
      exit 1
    fi
  done
done
echo "    ok"

echo "==> down (full rollback must leave no application tables)"
COUNT=$(psql "$DATABASE_URL" -X -t -A -c \
  "SELECT count(*) FROM pg_tables WHERE schemaname='public'")
for _ in $(seq 1 "$(ls "$MIG"/*.sql | wc -l | tr -d ' ')"); do
  dbmate --url "$DATABASE_URL" --migrations-dir "$MIG" --no-dump-schema rollback >/dev/null
done
LEFT=$(psql "$DATABASE_URL" -X -t -A <<'SQL'
SELECT coalesce(string_agg(tablename, ', '), '')
  FROM pg_tables WHERE schemaname = 'public' AND tablename <> 'schema_migrations';
SQL
)
if [ -n "$LEFT" ]; then
  echo "FAIL: tables left after full rollback: $LEFT" >&2
  exit 1
fi
echo "    ok (had $COUNT tables before rollback)"

echo "==> cleanup"
dbmate --url "$DATABASE_URL" --migrations-dir "$MIG" drop >/dev/null
echo "PASS"
