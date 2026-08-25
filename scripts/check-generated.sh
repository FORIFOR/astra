#!/usr/bin/env bash
# 生成物が最新かを検査する。実装仕様 §14.3-3。
#
#   DATABASE_URL=... ./scripts/check-generated.sh
#
# schema.sql と Kysely の型は生成物なので、マイグレーションを足したのに
# 再生成し忘れた状態をレビューで見つけるのは難しい。CI で機械的に落とす。
set -euo pipefail

: "${DATABASE_URL:?DATABASE_URL is required}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

dbmate --url "$DATABASE_URL" --migrations-dir "$ROOT/infra/db/migrations" drop >/dev/null 2>&1 || true
dbmate --url "$DATABASE_URL" --migrations-dir "$ROOT/infra/db/migrations" \
  --schema-file "$TMP/schema.sql" up >/dev/null

# pg_dump のバージョン差分（ヘッダの "Dumped by" 等）は無視して本体だけ比べる
strip() { grep -v '^-- Dumped' "$1" | grep -v '^--$' | sed '/^$/d'; }
if ! diff -u <(strip "$ROOT/infra/db/schema.sql") <(strip "$TMP/schema.sql") > "$TMP/schema.diff"; then
  echo "FAIL: infra/db/schema.sql is stale. Run: pnpm db:migrate" >&2
  head -40 "$TMP/schema.diff" >&2
  exit 1
fi
echo "schema.sql is current"

# ルートで npx すると typescript 無しの別コピーが降ってくるので、
# 依存が揃っている packages/db の中で実行する
(cd "$ROOT/packages/db" && pnpm exec kysely-codegen \
  --url "$DATABASE_URL" --dialect postgres --out-file "$TMP/schema.ts") >/dev/null
if ! diff -q "$ROOT/packages/db/src/generated/schema.ts" "$TMP/schema.ts" >/dev/null; then
  echo "FAIL: packages/db/src/generated/schema.ts is stale. Run: pnpm db:codegen" >&2
  diff -u "$ROOT/packages/db/src/generated/schema.ts" "$TMP/schema.ts" | head -40 >&2
  exit 1
fi
echo "generated database types are current"

dbmate --url "$DATABASE_URL" --migrations-dir "$ROOT/infra/db/migrations" --no-dump-schema drop >/dev/null
