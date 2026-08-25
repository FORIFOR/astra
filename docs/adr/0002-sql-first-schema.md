# ADR 0002 — スキーマの正本は素の SQL

- 状態: Accepted (2026-08-26)
- 関連: 実装仕様 §5 / 逸脱 D-07、正本 §18

## 文脈

正本 §18 はテーブル一覧を SQL 語彙で定義しており、RLS・部分インデックス・
append-only トリガ・ハッシュ連鎖といった、ORM のスキーマ DSL では表現しづらい
要素を前提にしている。

## 決定

- マイグレーションは `infra/db/migrations/*.sql`（素の SQL）。適用は dbmate。
- `infra/db/schema.sql` は dbmate が生成し、コミットする。
- クエリは Kysely。`Database` 型は `schema.sql` から `kysely-codegen` で生成し、
  生成物をコミットして CI で鮮度を検査する。
- ORM（Prisma / TypeORM）は採用しない。

## 帰結

良い点:

- RLS ポリシー、`FORCE ROW LEVEL SECURITY`、部分ユニークインデックス、
  トリガによる append-only 強制を素直に書ける
- スキーマの変更履歴がレビュー可能な SQL として残る
- pgvector（Phase 2 以降）の導入に制約が入らない

悪い点 / 対策:

- 型が自動で付かない → codegen をビルド前提にし、CI で最新性を強制
- マイグレーションの手書きコスト → append-only / RLS のテンプレートを用意する
