# 新AIプラットフォーム 詳細設計仕様書 v0.1 — 準拠監査（2026-08-29）

正: `new_ai_platform_design_spec_v0.1.md`。機械的に照合できる章から検証した。
mock と real を分け、未検証は「未検証」と書く。

## 準拠している（実測）

| 章                     | 要求                                             | 実測結果                                                                                                                                                                                                  |
| ---------------------- | ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| §17 Service Boundaries | 12 サービス                                      | ✅ 全 12 実在（api-gateway / conversation / context / task / research / meeting / library / share / plugin-registry / agent-runtime / world-model / notification）＋ agent-host・capabilities・connectors |
| §18 Core Data Model    | 31 テーブル                                      | ✅ 28 実在（`connector_accounts` は `connector_connections` として実装＝同義）。全 tenant table に tenant_id・RLS                                                                                         |
| §19 API Contract       | 主要 13 経路                                     | ✅ 12 実在。**`GET /v1/conversations/{id}/stream` が欠落 → 本コミットで実装**                                                                                                                             |
| §20 Realtime Event     | 16 event type + envelope                         | ✅ 全 16 型・`event_id`/`sequence`・Last-Event-ID 再開・欠番検知まで実装                                                                                                                                  |
| §25 Acceptance         | 6 領域の観点                                     | ✅ 123 テストファイルで全観点をカバー（参照解決3 / speaker14 / reconnect9 / contradiction6 / freshness3 / 重複14 / stale7 / timeout24 / escalation2 / rollback2 / signature4）                            |
| §16 Stack              | fastify / kysely / Temporal / Redis / PostgreSQL | ✅ 実在（Temporal は compose で稼働）                                                                                                                                                                     |

## 本コミットで埋めたギャップ

1. **§19 `GET /v1/conversations/{id}/stream`**: `ConversationService.eventsAfter` と SSE ルートを追加。
   既存の task/meeting stream と同じ機構（`event_streams` + `readEventsAfter` + `redisWaker`）を使い、
   `StreamKind` に既にあった `'conversation'` を活かす。統合テスト 3 本（全リプレイ / Last-Event-ID 再開 /
   未知会話は開く前に 404）を追加。**CI（実 Postgres）で 3/3 実測 PASS**（commit 920ec73）。
   実装過程で 2 件の実バグを検出・修正: ①テストハーネス `makeTestApp` が任意依存の
   `conversations` を積んでおらず会話経路が未登録だった（本番同様に積むよう修正）、
   ②`TERMINAL_TYPES` に `conversation.completed` が無く会話ストリームが閉じなかった（§20 の
   終端として追加。Task Dock の購読が開きっぱなしになる実害）。
2. **§10.2 `world_embeddings` + pgvector**: SQL は用意したが **`infra/db/migrations/` にはまだ置いていない**。
   `docs/pending-migrations/20260829010000_world_embeddings.sql` に保留中。理由は下記「未検証」。
   （元の記述）仕様が挙げる 5 表のうち唯一欠けていた表を追加
   （entity×model 一意、RLS、`CREATE EXTENSION vector`）。

## 未検証（この環境の制約）

- **DB 適用と統合テスト実行は未実施**。Docker Engine が起動できず（`Docker Desktop is unable to start`、
  `docker info` が無応答）、`with-test-db.sh` が使う Postgres :5433 を立てられないため。
- pgvector は **プロジェクトの compose イメージ `pgvector/pgvector:pg16` に同梱**されているので
  migration 自体は CI/dev で動く。ただし **ローカルの Homebrew PostgreSQL 14 には pgvector が無く**、
  かつ `schema.sql` は PG16 からダンプされた正本なので、**PG14 で再生成すると差分が混ざる**。
  そのため `world_embeddings` の migration は `docs/pending-migrations/` に置き、
  `infra/db/migrations/` へは入れていない（入れると `check-generated.sh` の鮮度ゲートが落ちる）。
- **復帰手順**: Docker 復旧後に
  `mv docs/pending-migrations/20260829010000_world_embeddings.sql infra/db/migrations/` →
  `pnpm dev:infra` → `pnpm db:migrate`（schema.sql を再ダンプ）→
  `./infra/db/with-test-db.sh pnpm --filter @astra/service-api-gateway test` で
  SSE 統合テストと合わせて実測できる。

## 未達（実装方針の相違・要判断）

- **§18 `agent_profiles` / `agent_runs`**: 未実装。現状 agent の実行は `tasks` / `task_events` と
  `agent_hosts` で表現しており、agent 単位の profile / run を独立エンティティにしていない。
  仕様どおり分けるか、現行モデルを正とするかは製品判断。
