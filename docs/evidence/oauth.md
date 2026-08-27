# OAuth — 実装の実測

2026-08-27。**Google の OAuth Client は人が作るもの**なので立てられない。
代わりに、仕様どおりに振る舞う認可サーバを立てて、端末側の実装を丸ごと通した。

ここで verified になるのは**実装**であって、Google 上の接続ではない。
実アカウントの疎通は Client を作ってからで、そこは別に記録する。

## 通したもの（実 HTTP、9 件すべて PASS）

| 見たこと                                                          | 結果 |
| ----------------------------------------------------------------- | ---- |
| ブラウザ → 同意 → **loopback で受け取る**                         | PASS |
| `code_challenge_method=S256` を送り、**verifier は送らない**      | PASS |
| **verifier が合わなければ断られる**（盗んだコードを別の窓で使う） | PASS |
| **同じコードは二度使えない**                                      | PASS |
| **state の違う折り返しを受け取らない**（CSRF）                    | PASS |
| token は保管庫へ、**サーバへ渡るのは参照だけ**                    | PASS |
| 期限が近づけば更新し、応答に refresh token が無くても失わない     | PASS |
| **取り消されたら、黙って続けず失敗として出す**（OAuth revoke）    | PASS |
| 接続を切ったら保管庫から消える                                    | PASS |

同意画面で scope を 1 つ外した場合も確かめた。
**要求した 2 つではなく、許された 1 つだけ**が記録される。
要求した側を記録すると、許していない操作を許したことになる。

## macOS Keychain の往復（この端末で実測）

```
missing        -> null
round trip     -> ok
update         -> second
after delete   -> null
delete twice   -> ok
```

`security` を対話なしで通せることを確認した（試験用の項目は削除済み）。
無い項目を「無い」と答え、他の失敗と混ぜないことも確認した。

## まだできていないこと

**実アカウントでの疎通。**Google OAuth Client（デスクトップ用）が要る。
これは Cloud Console でしか作れず、API も無いので、人の操作になる。

Client ID を `ASTRA_OAUTH_GOOGLE_CLIENT_ID` に入れると、
`oauth_providers` が real になり、本番起動の最後の 1 つが埋まる。
