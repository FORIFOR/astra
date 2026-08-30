# Release — Astra macOS

版: **0.1.0**（`package.json` / `tauri.conf.json` / 両 `Cargo.toml` で一致。
`scripts/verify-release-consistency.sh` が見ている）

**この文書の約束**: 確かめていないものを「確認済み」と書かない。
配れないものを「配れる」と書かない。

---

## 0. いまの判定

```
Readiness = SIGNED_NOT_NOTARIZED
```

配布できる形まで作れているが、**公証（notarization）が済んでいないので配れない**。
公証を通すには Apple ID と app 用パスワードが要り、これは私（アシスタント）が
用意できるものではない。入れ方は §3。

| | 状態 |
| --- | --- |
| 版番号の一致 | ✅ 0.1.0 で 4 か所一致 |
| 自動ゲート | ✅ `pnpm verify:all` = VERIFY_ALL_OK |
| 録音の E2E | ✅ `RECORDING_EXPERIENCE_OK` |
| release ビルド | ✅ Rust も Swift も release |
| Developer ID 署名 | ✅ Shuhei Horio (6RR7572ZLU) |
| hardened runtime | ✅ `flags=0x10000(runtime)` |
| 外部 dylib への依存 | ✅ 無し（静的リンク） |
| 署名済み .app の実動 | ✅ 8 ゲートを **配布物そのもの**で通した |
| **公証** | ❌ 資格情報が無い |
| 配布先 | ❌ 未定（置き場も更新の仕組みも無い） |
| Windows | ❌ 別（`apps/windows`。CI で実ビルドまで） |

---

## 1. 作り方

```sh
bash scripts/release-macos.sh
```

やること:

1. `cargo build --release`（**Rust も release**。忘れると配布物に debug が入る）
2. `swift build -c release`
3. 外部 dylib を掴んでいないか確認して、掴んでいたら止める
4. `.app` を組む。版番号は `package.json` から取る（plist に直書きしない）
5. Developer ID + hardened runtime で署名し、`codesign --verify --strict` で確認
6. zip を作る
7. 公証 → staple → `spctl --assess`

資格情報が無ければ 6 の後で止まり、`RELEASE_READINESS=SIGNED_NOT_NOTARIZED`
を出して終了コード 3 を返す。

### `package-macos-app.sh` との違い

あちらは **Apple Development 署名の開発用**で、実機の TCC プロンプトを出すためのもの。
自分の Mac でしか動かない。配布には使わない。

---

## 2. 過去に踏んだもの（同じ穴に落ちないように）

- **配布物が起動しなかった。** `Package.swift` が `-L target/debug -lastra_core`
  だったので、cargo が同じ場所に置く `.a` と `.dylib` のうちリンカが `.dylib` を選び、
  署名済み .app が**ソースツリーの絶対パスにある debug の dylib** を参照していた。
  他人の Mac には無いので起動しない（Team ID 不一致で落ちる）。
  `.a` を位置引数で直に渡して静的リンクにした。`ASTRA_CORE_LIB_DIR` で
  release へ切り替える。ゲートでも見ている。
- **用途説明が足りないとプロセスが落ちる。** TCC は拒否ではなく SIGABRT。
  要求しうる権限は全部 plist に書く。`verify-usage-descriptions.sh` が
  両方のスクリプトと実際の .app を突き合わせている。

---

## 3. 公証を通すには（人の手が要る）

```sh
xcrun notarytool store-credentials "astra-notary" \
  --apple-id <Apple ID> \
  --team-id 6RR7572ZLU \
  --password <app 用パスワード>          # appleid.apple.com で作る
```

一度入れれば keychain に残る。あとは `bash scripts/release-macos.sh` を
もう一度実行すれば、公証 → staple → `spctl` まで進んで
`RELEASE_READINESS=NOTARIZED` になる。

`ASTRA_NOTARY_PROFILE` でプロファイル名を変えられる。

---

## 4. まだ決まっていないこと

配布まで進めるなら、この 3 つは人が決める必要がある。

1. **置き場所**（GitHub Releases / 自前の配布先）
2. **更新の仕組み**（Sparkle 等。いまは無いので、入れ替えは手動）
3. **gateway の向き先**。`docs/production-readiness.md` の判定は
   Client ID を入れた状態のもの。配布ビルドがどこを向くかは未決。

---

## 5. 手で見る確認

アシスタントは GUI を人の目で見られないので、代わりに
**配布物そのもの**で自己検査を回している（`dist/Astra.app` を直接起動）:

```
acceptance / session / sessionsync / recordbutton / storage / plugins / state / permissions
```

これは人の目視の代わりにはなるが、同じものではない。
配る前には、少なくとも次を人が見ること:

- 初回起動でマイク・画面収録・カレンダーの許可が正しく出るか
- 録音 → 停止 → カードが Ready になるまで
- Dock が他アプリの上で邪魔になっていないか
