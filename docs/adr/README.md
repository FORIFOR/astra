# Architecture Decision Records

1 決定 1 ファイル。`docs/spec/phase-0-implementation-spec.md` §17 の逸脱表と対応する。

| ADR                                         | 決定                                                        | 状態     |
| ------------------------------------------- | ----------------------------------------------------------- | -------- |
| [0001](0001-modular-monolith-deployment.md) | Phase 0〜3 はサービス境界を保ったまま単一プロセスで動かす   | Accepted |
| [0002](0002-sql-first-schema.md)            | スキーマの正本は素の SQL。ORM に所有させない                | Accepted |
| [0003](0003-sse-for-server-streams.md)      | サーバ→クライアントの一方向配信は SSE、双方向のみ WebSocket | Accepted |
