# ADR 0004 — HTTP 層に Fastify を採用する

- 状態: Accepted (2026-08-26)
- 関連: 実装仕様 §11、正本 §17・§19・§20

## 文脈

正本は HTTP フレームワークを指定していない。Phase 0〜3 の api-gateway が扱う必要があるのは:

- REST（§19）
- SSE によるサーバ→クライアント配信（ADR 0003）
- WebSocket（Local Host Bridge、会議音声）
- multipart アップロード（§8.3）
- ルートごとに単位の違うレート制限（§4.5）

## 決定

**Fastify 5** を採用する。

- ロガーは pino で、`@astra/telemetry` がすでに pino を使っているのでそのまま差し込める。
- `inject()` があるので、ポートを開かずに実物のルーティング・フック・エラーハンドラを通した
  結合テストが書ける。
- WebSocket / multipart / SSE の公式プラグインが揃っている。
- `trustProxy` があり、Cloud Run のようなプロキシ配下で client IP を正しく取れる。
  レート制限のキーになるため必須。

Express は SSE / WS の型と非同期エラー処理が弱く、Hono は Node での WS と
multipart まわりで追加の配線が要るため見送った。

## 帰結

良い点:

- `app.inject()` により HTTP 結合テストが速く、外部プロセスを立てずに済む
- 型が効いたフックで request id・レート制限・認証を一列に並べられる

悪い点 / 対策:

- `loggerInstance` に pino の `Logger` を渡すとインスタンス型のジェネリクスが固定され、
  素の `FastifyInstance` と代入互換でなくなる → `src/fastify.ts` の `App` 別名に統一する
- フレームワーク固有 API がサービス層へ漏れやすい → ルートハンドラは
  `@astra/contracts` の型で入出力し、Fastify 型はハンドラ境界の外へ出さない
