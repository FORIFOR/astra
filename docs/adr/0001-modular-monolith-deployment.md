# ADR 0001 — Phase 0〜3 は modular monolith としてデプロイする

- 状態: Accepted (2026-08-26)
- 関連: 実装仕様 §2.3 / 逸脱 D-01、正本 §16.1・§17

## 文脈

正本 §17 は 12 個のサービス境界を定義している。これをそのまま 12 個の
Cloud Run サービスとして立てると、Phase 0 の Exit（create task → progress → artifact）を
確認する前に、サービス間認証・サービスディスカバリ・分散トレース・12 本の CI/CD が必要になる。

## 決定

- **コードのサービス境界は正本どおりに保つ。**`services/*` は独立 package とし、
  他サービスの内部モジュールを import しない。相互通信は `packages/contracts` の
  interface 経由のみ、必ず `async`。
- **デプロイは Phase 0〜3 のあいだ 1 プロセス**に畳む。`services/api-gateway` が
  各サービスを in-process で composition する。
- Phase 4（Plugin Platform）で実際の分割を行う。

## 帰結

良い点:

- Phase 0 の検証対象が「縦串が通るか」だけになる
- ローカル起動が 1 コマンドで済み、受け入れテストが速い

悪い点 / 対策:

- 境界が形骸化する危険 → 実装仕様 §14.3 の CI 検査で機械的に禁止する
  （他サービスの内部 import 禁止、所有テーブル以外への直接 SQL 禁止、
  サービス境界をまたぐトランザクション禁止）
- 分割時のコストは残る → 通信を最初から async interface にしておくことで、
  実装の差し替えで分割できる状態を維持する
