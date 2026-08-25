-- 拡張と共有関数。実装仕様 §5.3。
-- migrate:up

CREATE EXTENSION IF NOT EXISTS citext;

-- append-only テーブルの UPDATE / DELETE / TRUNCATE を DB 側で拒否する。
-- 正本 §9.4「immutable action receipt」/ §21「append-only audit event」。
-- アプリ側の規律ではなく DB の制約として持つ（受け入れテスト AC-16）。
--
-- 文レベル (FOR EACH STATEMENT) で張ること。行レベルだと
--   * 0 行に一致する UPDATE / DELETE がそのまま成功する
--   * TRUNCATE を素通しする
-- ため、append-only の保証にならない。
CREATE OR REPLACE FUNCTION astra_deny_mutation() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'table % is append-only (attempted %)', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'restrict_violation';
END $$;

-- migrate:down
DROP FUNCTION IF EXISTS astra_deny_mutation();
DROP EXTENSION IF EXISTS citext;
