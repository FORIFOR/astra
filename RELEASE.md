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
| 同梱プラグイン | ✅ 12 件をバンドルへ。repo の外から起動して画面で確認 |
| 初回起動 | ✅ 何も無い状態から DB を作って起動（`ASTRA_DATA_ROOT`） |
| 署名済み .app の実動 | ✅ **配布物そのもの**で 47 ゲート PASS / 2 SKIP / 0 FAIL |
| Gatekeeper の実測 | ❌ `rejected` / `source=Unnotarized Developer ID` |
| **公証** | ❌ 資格情報が無い |
| 自動更新 | ✅ Sparkle 2.9.6 を同梱・署名。設定が揃った状態で起動を確認 |
| 更新の出し方 | ✅ `scripts/publish-update.sh`（appcast まで作る。上げはしない） |
| Sparkle 署名鍵 | ✅ 作成済み・公開鍵は release-macos.sh の既定値 |
| 配布先 URL | ❌ 未定（appcast の置き場が決まっていない） |
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
- **同梱プラグインが手元でしか読めなかった。** バンドルへ入れておらず、
  解決の候補に開発機の絶対パスが 1 本入っていたので、私の Mac でだけ 12 件読めていた。
  配った先では 0 件になる。バンドルへ同梱し、個人のパスは消した。
  cwd 相対も当てにしない（ゲートは `apps/astra-macos` へ cd して動かすので外れる）
  —— 実行体から上へ辿って探す。
- **初回起動を試せなかった。** macOS の `applicationSupportDirectory` は HOME を
  見ずに実ユーザーから解決するので、HOME を変えても隔離できない。
  `ASTRA_DATA_ROOT` で置き場所を差し替えられるようにした。利用者のデータを
  退避させずに「何も無いところから」を確かめられる。

---

## 2.5 自動更新（Sparkle）

同梱済み。**設定が揃うまで動かない**——appcast の URL と公開鍵のどちらかが
欠けたまま起動すると、確かめているつもりで何も見ていない状態になるため。

鍵は**作成済み**（2026-08-31）。公開鍵はこれで、`release-macos.sh` の既定値に
入っている（公開鍵なので秘密ではない。アプリに埋めて配るもの）:

```
b61dWnFNEdpzAWG/V5SMb4bZGrqgzJwMDAcuw/564cs=
```

対の**秘密鍵はこの Mac の keychain にある**（"Private key for signing Sparkle updates"）。
失うと以後の更新に署名できない。別の鍵に変えると、既に配った版は新しい更新を
検証できなくなる。機械を移るときは `generate_keys -x` で書き出して持っていく。

残るは配布先の URL だけ。決まったら:

```sh
ASTRA_UPDATE_FEED=https://…/astra/appcast.xml bash scripts/release-macos.sh
```

更新を 1 つ出す（appcast を作るところまで。**置きに行くのは人**）:

```sh
ASTRA_UPDATE_BASE=https://…/astra bash scripts/publish-update.sh
```

公証していないものは更新として出せない（スクリプトが止める）。
黙って入れ替えない（`SUAutomaticallyUpdate=false`）。

確かめたこと: 設定を入れた .app で `--selftest update` が「設定済み」を返し、
実際に起動して 12 秒生存する。未設定なら更新の口は動かない。

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

1. **置き場所**。自前の配布先という方針までは決まっている。URL が決まれば
   `ASTRA_UPDATE_FEED` と `ASTRA_UPDATE_BASE` に入れるだけ。
2. ~~**Sparkle の署名鍵**~~ 作成済み（§2.5）。
3. **gateway の向き先**。`docs/production-readiness.md` の判定は
   Client ID を入れた状態のもの。配布ビルドがどこを向くかは未決。

---

## 5. 手で見る確認

アシスタントは GUI を人の目で見られないので、代わりに
**配布物そのもの**で自己検査を回している（`dist/Astra.app` を直接起動）:

zip を別の場所へ展開し、リポジトリの外を作業ディレクトリにして 49 件:

```
44 PASS / 3 FAIL
```

落ちている 3 件（`shortcut` / `dictation` / `e2e001`）は**この機械の許可の状態**で、
コードの問題ではない。`listen=true ax=true` なのに `tapEnabled=false`——
再ビルドで実行体が変わると、preflight は true のまま tap だけ拒まれる。
同じ 3 件が、今朝緑だったコミット（4ee835b）を建て直しても同じように落ちる。
直すには、システム設定 > プライバシーとセキュリティ > 入力監視 で
Astra を一度外して入れ直す（人の操作）。

これは人の目視の代わりにはなるが、同じものではない。
配る前には、少なくとも次を人が見ること:

- 初回起動でマイク・画面収録・カレンダーの許可が正しく出るか
- 録音 → 停止 → カードが Ready になるまで
- Dock が他アプリの上で邪魔になっていないか
