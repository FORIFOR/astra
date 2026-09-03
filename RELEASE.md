# Release — Astra macOS

版: **0.1.1**（`package.json` / `tauri.conf.json` / 両 `Cargo.toml` で一致。
`scripts/verify-release-consistency.sh` が見ている）

**この文書の約束**: 確かめていないものを「確認済み」と書かない。
配れないものを「配れる」と書かない。

---

## 0. いまの判定

```
Readiness = NOTARIZED
```

**0.1.1 は配れる形になっている。** 2026-09-03 に公証を通した
（submission `bbc1db00-…` / status Accepted / staple 済み）。
利用者が受け取る形——zip に quarantine の印が付いた状態——で実測:

```
Gatekeeper: 受理・券あり（落としてきた状態でも、圏外でも開ける）
RELEASE_ARTIFACT_OK: 47 PASS / 0 SKIP / 0 FAIL（repo の外・まっさらな置き場）
```

配布物: `dist/Astra-0.1.1.zip` (9,679,166 bytes) / universal (arm64 + x86_64)
sha256: `d57e977543ffc09072a919a82afa2c536ea205a6adc1d2a160229a931bcc3e44`
appcast: `dist/feed/appcast.xml`（EdDSA 署名済み。0.1.0 → 0.1.1 の delta 16,450 bytes も同梱）

**公開済み**（2026-09-03、本人の指示で）: https://github.com/FORIFOR/astra/releases/tag/v0.1.1
添付: `Astra-0.1.1.zip` / `Astra0.1.1-0.1.0.delta` / `appcast.xml`。
公開後に `releases/latest/download/appcast.xml` を取り直して手元の appcast と一致、
zip の sha256 も一致を確認した。0.1.0 の利用者には自動更新で届く。

0.1.0（384b46a）からの変更 92 commit は画面の言葉と時間軸の直し:
DS-01〜06 の造形規則、Craft Freeze、journey J-A/J-B/J-C（頼む・録る・断られる）を
最後まで通す検証、失敗時に袋小路を作らない直し（マイク拒否・共有中・強制終了）、
一覧の状態語を日本語に（録音中 / 会話を読み取っています… / 使えます）。

**前の版**: https://github.com/FORIFOR/astra/releases/tag/v0.1.0
（`Astra-0.1.0.zip` sha256 `571a00271f8469036464333233ee285e27d19480a1c611b2c52661c49235310b`）

| | 状態 |
| --- | --- |
| 版番号の一致 | ✅ 0.1.1 で 4 か所一致（`verify-release-consistency.sh`） |
| 自動ゲート | ✅ `pnpm verify:all` = VERIFY_ALL_OK |
| 録音の E2E | ✅ `RECORDING_EXPERIENCE_OK` |
| release ビルド | ✅ Rust も Swift も release |
| Developer ID 署名 | ✅ Shuhei Horio (6RR7572ZLU) |
| hardened runtime | ✅ `flags=0x10000(runtime)` |
| 外部 dylib への依存 | ✅ 無し（静的リンク） |
| 同梱プラグイン | ✅ 12 件をバンドルへ。repo の外から起動して画面で確認 |
| 初回起動 | ✅ 何も無い状態から DB を作って起動（`ASTRA_DATA_ROOT`） |
| 署名済み .app の実動 | ✅ **配布物そのもの**で 47 ゲート PASS / 2 SKIP / 0 FAIL |
| Gatekeeper の実測 | ✅ **落としてきた状態**で `accepted` / `Notarized Developer ID` |
| **公証** | ✅ Accepted・staple 済み・quarantine 付きで Gatekeeper 受理 |
| 自動更新 | ✅ Sparkle 2.9.6 を同梱・署名。設定が揃った状態で起動を確認 |
| 更新の出し方 | ✅ `scripts/publish-update.sh`（appcast まで作る。上げはしない） |
| Sparkle 署名鍵 | ✅ 作成済み・公開鍵は release-macos.sh の既定値 |
| 配布先 | ✅ GitHub Releases（FORIFOR/astra） |
| 自動更新 | ✅ 有効（appcast 署名済み・feed URL は版に依らず固定） |
| 対応 CPU | ✅ Apple Silicon / Intel（universal） |
| Windows | ❌ 別（`apps/windows`。CI で実ビルドまで） |

---

## 0.4 不特定多数へ配ると決めたので

方針: **不特定多数へ配布**（2026-08-31 決定）。したがって §0.5 の
「右クリックで開いてもらう」道は使えない —— 全員に手順を伝えられないし、
「壊れています」と出て終わる人が必ず出る。**公証は必須**。

公開配布に合わせて入れたもの:

| | |
| --- | --- |
| アイコン | ✅ 同梱（無いと Finder でも Dock でも空白になる） |
| Dock に出さない | ✅ `LSUIElement`（常駐の Task Dock が入口。`main.swift` の `.accessory` と一致） |
| 分類・著作権 | ✅ `LSApplicationCategoryType` / `NSHumanReadableCopyright` |
| 記号 | ✅ 署名前に `strip -x` |

残る体裁の話: panic の位置文字列に、ビルドした人の絶対パスが 175 件残る。
Rust 側は `--remap-path-prefix` で畳んでいるが、依存の C ソース（ring）は
`cc` が埋めるので rustc のフラグでは畳めない。`strip` は記号を消すもので、
`__TEXT` のリテラルには効かない。**機能でも安全性でもないので止めない**。

---

## 0.5 公証なしで配る道（いまは使わない）

公証が済むまで待たなくても、**相手が限られているなら配れる**。
受け取った人が初回だけ Gatekeeper を通す必要がある、というだけ。

実測: quarantine の印を外した `Astra.app` は、**そのまま起動して動く**
（DB を作り、生存する）。`spctl` は unnotarized なので rejected のままだが、
印が無ければ macOS は起動を許す。

受け取る人への説明（そのまま渡せる）:

> 1. `Astra-0.1.0.zip` を展開して `Astra.app` を「アプリケーション」へ入れる
> 2. **右クリック（二本指クリック）→「開く」**→ ダイアログで「開く」
>    （ダブルクリックだと「開けません」と言われる。初回だけの手順）
> 3. 初回起動時に、マイク・画面収録・カレンダー・**入力監視**の許可を聞かれる。
>    入力監視を許可しないと ⌥Space が効かない
>
> うまくいかないときは、ターミナルで:
> `xattr -dr com.apple.quarantine /Applications/Astra.app`

**向くとき**: 相手が数人で、手順を伝えられる。社内・知人向け。
**向かないとき**: 不特定多数へ配る。「壊れています」と出て終わる人が必ず出る。

公証を通せば、この手順は要らなくなる（§3）。

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
7. 公証 → staple → `spctl --assess`（**staple まで通す**。§2 の最後を見ること）

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
- **`spctl` だけで「公証済み」と判断しない。** 評価は経路ごとに再利用されるので、
  公証していない版でも「受理」と出ることがある（実際に出た。同じ場所で前に
  公証した版の評価が効いていた）。券が貼られているか（`stapler validate`）を
  別に見る。券が無いと**ネットに繋がっていない利用者は開けない**。
  `verify-release-artifact.sh` は両方を見て、券が無ければ
  `SIGNED_NOT_STAPLED` と言う。
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

## 2.6 公開の手順（GitHub Releases に置くもの）

本人の「公開して」があってから。1 つの Release に **5 点**を添える:

```sh
python3 docs/guide/build.py                       # ~/Downloads/Astra-操作ガイド/ を作り直す（メニューの絵と画面の語は .build/debug の AstraMac に訊く: --selftest menutitles / facts。先に swift build。写し違いは scripts/verify-guide-facts.sh が落とす）
cp ~/Downloads/Astra-操作ガイド/Astra-操作ガイド.pdf docs/guide/   # repo にも残す
gh release create v<版> --title "Astra <版>" --notes-file <本文> \
  dist/Astra-<版>.zip dist/feed/appcast.xml dist/feed/*.delta \
  "<PDF>#Astra 操作ガイド (PDF, 日本語)"            # 名前は Astra-<版>-guide-ja.pdf にして渡す
gh release upload v<版> "<PDF を Astra-guide-ja.pdf に複製したもの>"
```

| 添付 | 役割 |
| --- | --- |
| `Astra-<版>.zip` / `appcast.xml` / `*.delta` | アプリと自動更新。feed URL は `releases/latest/download/appcast.xml` で固定 |
| `Astra-<版>-guide-ja.pdf` | **この版の**操作ガイド（監査・特定版の利用者向け） |
| `Astra-guide-ja.pdf` | 版番号なしの同じ PDF。一般利用者へ案内する固定 URL はこれ: `https://github.com/FORIFOR/astra/releases/latest/download/Astra-guide-ja.pdf`。アプリのメニューバー「操作ガイド（PDF）」もこの URL を開く（`StatusBarController.guideURL`。名前を変えたら両方）。同じメニューの「更新を確認…」は Sparkle の確認で、appcast の無い実行体では理由を出して `releases/latest` へ案内する |

Release 本文には「入れ方」の後に「操作ガイド」の節を置き、上の固定 URL を貼る。
日本語のファイル名で上げると GitHub が `Astra-.pdf` に削るので、ASCII 名にしてから渡す。
公開後は `releases/latest/download/` から appcast・zip・PDF を取り直し、手元と一致を確かめる。

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

1. ~~**置き場所**~~ GitHub Releases。
   `ASTRA_UPDATE_FEED=https://github.com/FORIFOR/astra/releases/latest/download/appcast.xml`
   `ASTRA_UPDATE_BASE=https://github.com/FORIFOR/astra/releases/download/v<版>`
2. ~~**Sparkle の署名鍵**~~ 作成済み（§2.5）。
3. ~~**置き場所**~~ GitHub Releases に決定。
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
