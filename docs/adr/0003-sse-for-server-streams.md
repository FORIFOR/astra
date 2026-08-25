# ADR 0003 — サーバ→クライアント配信は SSE、双方向のみ WebSocket

- 状態: Accepted (2026-08-26)
- 関連: 実装仕様 §7 / 逸脱 D-04、正本 §19・§20・§24

## 文脈

正本 §20 は「sequence で reconnect 後の再送を可能にする」ことを要求する。
また §19 は `GET /v1/conversations/{id}/stream` と `WS /v1/meetings/{id}/audio` を
書き分けており、一方向と双方向で方式が違うことを既に示唆している。

## 決定

| 用途                                                    | 方式                      |
| ------------------------------------------------------- | ------------------------- |
| task progress / conversation delta / meeting transcript | SSE (`text/event-stream`) |
| Local Host Bridge / 会議音声アップロード                | WebSocket                 |

- SSE の再開は `Last-Event-ID` ヘッダに `sequence` を載せる。
- サーバは購読（Redis）を先に張ってから DB のリプレイを読み、
  重複を `sequence` で除去してからライブへ切り替える（実装仕様 §7.3）。

## 帰結

良い点:

- 再接続・再送がプロトコル標準の機能で賄える
- HTTP のミドルウェア（認証・レート制限・ロギング）がそのまま効く
- プロキシ / LB の WebSocket 設定に依存しない

悪い点 / 対策:

- ブラウザの `EventSource` は独自ヘッダを付けられない → Desktop は fetch ベースの
  SSE クライアントを使う。share-web は署名付き短期 URL のクエリ認証を使う（Phase 2）
- 1 接続 1 ストリーム → 同時接続数の上限を device 単位で設ける（実装仕様 §4.5）
