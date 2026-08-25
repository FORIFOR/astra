# Astra

会話（音声 / テキスト）から、調べる・作る・動かすまでを一貫して行う AI プラットフォーム。

ユーザーに見せるトップレベル UI は **4 タブ固定**（ホーム / AIエージェント / ライブラリ / プラグイン）と、
OS のどこからでも呼び出せる **Task Dock**。North Star は **Intent → Done**。

> 話す / 打つ → AI が理解する → 調べる / 動く → 結果が Library に残る

## ドキュメント

| 文書                                                                                             | 役割                            |
| ------------------------------------------------------------------------------------------------ | ------------------------------- |
| [`docs/spec/new_ai_platform_design_spec_v0.1.md`](docs/spec/new_ai_platform_design_spec_v0.1.md) | **正本**（製品仕様 v0.1、凍結） |
| [`docs/spec/phase-0-implementation-spec.md`](docs/spec/phase-0-implementation-spec.md)           | Phase 0 実装仕様                |
| [`docs/adr/`](docs/adr/)                                                                         | 設計判断の記録                  |

## 現在地

**Phase 0 進行中。** 完了: P0-01（scaffold）/ P0-02・P0-03（`@astra/contracts`）。
次: P0-04（DB マイグレーション）。

実装順は正本 §28 に従う。

```text
Phase 0  Foundation          ← いまここ
Phase 1  Universal Interface（Task Dock v2 / 4タブ / ローカル STT）
Phase 2  Research + Library（Evidence Ledger / 共有リンク）
Phase 3  Meeting（V1 streaming diarization + Chirp 3 final pass）
Phase 4  Plugin Platform
Phase 5  First Specialist Agents
Phase 6  World Model / Proactivity
Phase 7  Regulated / Financial
```

## 構成

```text
apps/desktop         Tauri v2 + React。Local Control Plane と 4 タブ shell
apps/share-web       共有リンクの公開 viewer
services/*           Cloud Control Plane（正本 §17 のサービス境界）
workers/*            Temporal worker
packages/contracts   Zod を一次ソースとする API / イベント契約
packages/db          PostgreSQL 型付きアクセスとテナント境界
packages/*           ui-kit / agent-sdk / plugin-sdk / policy / telemetry
plugins/builtin/*    同梱プラグインの manifest
infra/*              terraform / cloudrun / db マイグレーション
evals/*              正本 §25 の受け入れスイート
```

Phase 0〜3 はサービス境界を保ったまま単一プロセスで動かす（[ADR 0001](docs/adr/0001-modular-monolith-deployment.md)）。

## 開発

必要なもの: Node >= 22, pnpm 10, Docker, Rust（Phase 1 以降）, dbmate。

```sh
pnpm install
cp .env.example .env
pnpm dev:infra        # postgres(+pgvector) / redis / temporal
pnpm db:migrate       # Phase 0 P0-04 以降
pnpm build
pnpm test
```

Temporal UI: http://localhost:8233

## 規約

- 契約（型・イベント・スキーマ）は `packages/contracts` の Zod が一次ソース。手書きの型を並置しない。
- DB へのアクセスは `packages/db` の `withTenant` / `withSystem` を経由する。生の SQL を service から直接投げない。
- サービスは他サービスの内部モジュールを import しない。
- append-only なテーブル（`action_receipts` / `audit_events`）は DB トリガで UPDATE / DELETE を拒否する。
