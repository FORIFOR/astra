# Genieへの名称統一

2026-09-13。ユーザーの依頼に基づき、製品表示・ソース構成・配布名・GitHub・公開サイトをGenieへ統一する。

## 変更の条件

reference : 現行デザインシステム DS-06「同じものは同じ語で呼ぶ」と、ユーザー指定の製品名Genie。
hypothesis: Home・Dock・設定・権限案内・配布物でGenieを共通の名前にすれば、サイトとアプリの名称が一致する。
measured : 現在の製品名Astra、Mac実行体AstraMac、サイト表示Genie。色・文字段・寸法は既存tokens.json。
candidates: A=サイトだけGenie／B=全ての現行製品面・開発パッケージ・配布名をGenie。
gate : Bを採用。ビルド・名称検査・保存データ互換テスト・既存verify-all・改名後の実機確認で検証。寸法tokenは変更しない。

## 継続する識別子

`com.astra.*`の署名・Keychain・接続済みプラグインID、既存のデータベースと設定キー、既存環境の`ASTRA_*`変数は互換性の対象。改名のためにOS権限や認証済みアカウントを削除しない。この改名では保存先も移動しない。OSが以前のアプリ名を表示している場合は、権限案内で旧名の行も検出する。

過去の実測ログ・画面収録・署名済みリリースは当時の名称を含む履歴として保持する。再生成した画面と配布物を新しい証跡として追加し、過去の成功結果やファイルhashを書き換えない。

## 検証

公開サイト: https://genie-forifor.forifor.chatgpt.site/ja

リポジトリ: https://github.com/FORIFOR/genie （旧GitHub URLの転送も確認）。

新しいMac実行体GenieMacのビルド、Swift/Rust間の生成コード、WindowsのC ABI、TypeScriptのビルドを確認。agent hostの192件とdesktopの352件が成功。Genie名の32画面（明/暗各16面）と6状態のgeometryを撮影。実ローカルモデルで会議要約を確認。全体ゲートの結果と配布物の検証は、この変更のPRとリリースに記録する。

操作ガイドは `docs/guide/Genie-guide-ja.pdf`。4ページを画像化して確認した。

Codex内の保存済みプロジェクト表示名は、Computer UseがCodexアプリの操作を拒否したため未変更。安全制限を回避してアプリ内部の設定を書き換えることはしない。
